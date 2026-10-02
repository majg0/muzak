import test from 'node:test';
import assert from 'node:assert/strict';
import { compileComposition, type CompositionPlan, type ScoreMaterial } from '../src/score/composition';
import { compareScores } from '../src/score/comparison';
import { stretchScore, transposeScore } from '../src/score/operations';
import type { Score, ScoreNote } from '../src/score/score';

const ppq = 12;
const context = (): Omit<Score, 'notes'> => ({ ppq, duration: 0, trackEnds: [0, 0], parts: [
  { id: 'lower', name: 'Lower', track: 0, channel: 0, percussion: false },
  { id: 'upper', name: 'Upper', track: 1, channel: 1, percussion: false },
], attachments: [] });
const note = (id: string, part: string, onset: number, duration: number, pitch: number, velocity = 80): ScoreNote =>
  ({ id, part, onset, duration, pitch: { millicents: pitch * 100000 }, velocity, releaseVelocity: 64 });

function originalPlan(first = 7, second = 5, upperCycle = 5): CompositionPlan {
  const span = (first + second) * ppq;
  const lower: ScoreMaterial = { id: 'lower-cycle', span, notes: [
    note('a', 'lower', 0, 6, 43), note('b', 'lower', 18, 9, 50),
    note('c', 'lower', first * ppq, 12, 46), note('d', 'lower', span - 12, 24, 53),
  ] };
  const upper: ScoreMaterial = { id: 'upper-cycle', span: upperCycle * ppq, notes: [
    note('x', 'upper', 3, 7, 72), note('y', 'upper', 21, 18, 76),
  ] };
  const performance = context();
  performance.duration = span * 3; performance.trackEnds = [span * 3, span * 3];
  performance.attachments = Array.from({ length: 6 }, (_, bar) => ({
    tick: Math.floor(bar / 2) * span + (bar % 2 ? first * ppq : 0), track: 0, order: bar,
    bytes: [255, 88, 4, bar % 2 ? second : first, 2, 24, 8],
  }));
  return { context: performance, materials: [lower, upper], placements: [
    ...Array.from({ length: 3 }, (_, i) => ({ material: lower.id, onset: i * span })),
    ...Array.from({ length: Math.floor(span * 3 / upper.span) }, (_, i) => ({ material: upper.id,
      onset: i * upper.span, transposeMillicents: (i % 3) * 100000, velocityScale: .75 + (i % 2) * .15 })),
  ] };
}

test('original independent cycles preserve mixed-meter context, silence, polyphony and sustained tails', () => {
  for (const [first, second, upperCycle] of [[7, 5, 5], [3, 4, 2], [5, 3, 3]]) {
    const plan = originalPlan(first, second, upperCycle), saved = structuredClone(plan), score = compileComposition(plan);
    const span = (first + second) * ppq;
    assert.deepEqual(plan, saved);
    assert.deepEqual(score.attachments, plan.context.attachments);
    assert.equal(score.notes.filter(n => n.part === 'lower').length, 12);
    assert.ok(score.notes.some(n => n.onset + n.duration > span * 3), 'A tail extends beyond the nominal final cycle.');
    assert.equal(score.duration, span * 3 + 12);
    assert.equal(score.trackEnds[0], score.duration);
    assert.ok(score.notes.some(a => score.notes.some(b => a.part !== b.part && a.onset < b.onset + b.duration && b.onset < a.onset + a.duration)));
    assert.ok(score.notes.every(n => !n.source), 'Generated events do not pretend to retain MIDI source ordering.');
  }
});

test('placing parallel materials is musically order-independent; sequence positions retain a chosen gap', () => {
  const plan = originalPlan(), first = compileComposition(plan);
  assert.equal(compareScores(first, compileComposition({ ...plan, placements: [...plan.placements].reverse() })).equal, true);
  const material = plan.materials[1], gap = 17;
  const sequence = compileComposition({ context: context(), materials: [material], placements: [
    { material: material.id, onset: 0 }, { material: material.id, onset: material.span + gap },
  ] });
  assert.equal(sequence.notes[2].onset - sequence.notes[0].onset, material.span + gap);
  assert.equal(sequence.duration, material.span * 2 + gap);
});

test('fractional placement scales share an exact raised PPQ and preserve tempo/controller coordinates', () => {
  const base = context(); base.duration = 30; base.trackEnds = [30, 30];
  base.attachments = [{ tick: 5, track: 0, order: 0, bytes: [176, 64, 127] }];
  const material: ScoreMaterial = { id: 'fractional', span: 11, notes: [note('n', 'lower', 1, 5, 60)] };
  const result = compileComposition({ context: base, materials: [material], placements: [
    { material: material.id, onset: 0, timeScale: { numerator: 2, denominator: 3 } },
    { material: material.id, onset: 13, timeScale: { numerator: 3, denominator: 2 }, partMap: { lower: 'upper' } },
  ] });
  assert.equal(result.ppq, ppq * 6);
  assert.deepEqual(result.notes.map(n => [n.onset, n.duration, n.part]), [[4, 20, 'lower'], [87, 45, 'upper']]);
  assert.equal(result.attachments[0].tick / result.ppq, 5 / ppq);
  assert.deepEqual(result.attachments[0].bytes, base.attachments[0].bytes);
});

test('inverse pitch/time transformations cancel, and velocity scaling has an explicit bounded meaning', () => {
  const material: ScoreMaterial = { id: 'phrase', span: 13, notes: [note('one', 'lower', 1, 5, 60, 80), note('two', 'lower', 7, 9, 64, 100)] };
  const plan: CompositionPlan = { context: context(), materials: [material], placements: [{ material: material.id, onset: 0 }] };
  const baseline = compileComposition(plan);
  const transformed = compileComposition({ ...plan, placements: [{ material: material.id, onset: 0,
    transposeMillicents: 312500, timeScale: { numerator: 2, denominator: 3 } }] });
  const inverted = transposeScore(stretchScore(transformed, 3, 2), -312500);
  assert.equal(compareScores(baseline, inverted).equal, true);
  const quiet = compileComposition({ ...plan, placements: [{ material: material.id, onset: 0, velocityScale: .5 }] });
  assert.deepEqual(quiet.notes.map(n => n.velocity), [40, 50]);
  assert.deepEqual(quiet.notes.map(n => n.releaseVelocity), [64, 64]);
  const loud = compileComposition({ ...plan, placements: [{ material: material.id, onset: 0, velocityScale: 2 }] });
  assert.deepEqual(loud.notes.map(n => n.velocity), [127, 127]);
});

test('malformed references and transforms fail rather than clipping or silently selecting another material', () => {
  const plan = originalPlan();
  assert.throws(() => compileComposition({ ...plan, materials: [...plan.materials, plan.materials[0]] }), /unique/);
  assert.throws(() => compileComposition({ ...plan, placements: [{ material: 'missing', onset: 0 }] }), /Unknown material/);
  assert.throws(() => compileComposition({ ...plan, placements: [{ material: plan.materials[0].id, onset: -1 }] }), /Invalid/);
  assert.throws(() => compileComposition({ ...plan, placements: [{ material: plan.materials[0].id, onset: 0, timeScale: { numerator: 1, denominator: 0 } }] }), /Invalid/);
  assert.throws(() => compileComposition({ ...plan, placements: [{ material: plan.materials[0].id, onset: 0, partMap: { lower: 'absent' } }] }), /Unknown composed part/);
  assert.throws(() => compileComposition({ ...plan, placements: [{ material: plan.materials[0].id, onset: Number.MAX_SAFE_INTEGER }] }), /safe integer/);
  const invalid = structuredClone(plan);
  invalid.materials[0].notes[0].velocity = 0;
  assert.throws(() => compileComposition(invalid), /Invalid material/);
});

test('nested shared edits reach both references, occurrence edits stay local, and a parallel layer stays unchanged', () => {
  const seed = originalPlan(), lower = seed.materials[0], upper = seed.materials[1];
  const plan: CompositionPlan = { context: context(), materials: [lower, upper], definitions: [
    { id: 'pair', span: lower.span * 2, placements: [
      { material: lower.id, onset: 0 }, { material: lower.id, onset: lower.span },
    ] },
  ], placements: [{ material: 'pair', onset: 0 }, { material: upper.id, onset: 9 }] };
  const saved = structuredClone(plan), baseline = compileComposition(plan);
  const shared = structuredClone(plan);
  shared.materials[0].notes[1].pitch.millicents += 250000;
  const changed = compileComposition(shared), difference = compareScores(baseline, changed);
  assert.equal(difference.missing.length, 2);
  assert.equal(difference.extra.length, 2);
  assert.ok(difference.extra.every(note => note.part === 'lower'));
  assert.deepEqual(changed.notes.filter(note => note.part === 'upper'), baseline.notes.filter(note => note.part === 'upper'));

  const occurrence = structuredClone(plan);
  occurrence.definitions![0].placements[1].transposeMillicents = 100000;
  const local = compileComposition(occurrence), delta = compareScores(baseline, local);
  assert.equal(delta.missing.length, lower.notes.length);
  assert.ok([...delta.missing, ...delta.extra].every(note => note.part === 'lower' && note.onset >= lower.span));
  assert.deepEqual(local.notes.filter(note => note.onset < lower.span), baseline.notes.filter(note => note.onset < lower.span));
  assert.deepEqual(plan, saved, 'Compilation and independent edits do not mutate the source plan.');
});

test('nested fractional scales cancel before note emission, with exact curves and child-then-parent routing', () => {
  const expressive = note('gesture', 'lower', 1, 5, 61, 91);
  expressive.pitchEnvelope = [{ tick: 0, pitch: { ...expressive.pitch } }, { tick: 3, pitch: { millicents: 6175000 } }];
  expressive.gainEnvelope = [{ tick: 0, gain: .8 }, { tick: 1, gain: .3 }, { tick: 5, gain: .9 }];
  const material: ScoreMaterial = { id: 'cell', span: 12, notes: [expressive] };
  const base = context(); base.duration = 19; base.trackEnds = [19, 19];
  base.attachments = [{ tick: 3, track: 0, order: 0, bytes: [255, 81, 3, 7, 161, 32] }];
  const nested: CompositionPlan = { context: base, materials: [material], definitions: [
    { id: 'phrase', span: 32, placements: [{ material: 'cell', onset: 4,
      timeScale: { numerator: 2, denominator: 1 }, transposeMillicents: 200000,
      velocityScale: .5, partMap: { lower: 'temporary-voice' } }] },
  ], placements: [{ material: 'phrase', onset: 3, timeScale: { numerator: 1, denominator: 2 },
    transposeMillicents: -100000, velocityScale: 2, partMap: { 'temporary-voice': 'upper' } }] };
  const flat: CompositionPlan = { context: base, materials: [material], placements: [
    { material: 'cell', onset: 5, transposeMillicents: 100000, partMap: { lower: 'upper' } },
  ] };
  const result = compileComposition(nested), expected = compileComposition(flat);
  assert.equal(result.ppq, ppq);
  assert.equal(compareScores(result, expected).equal, true);
  assert.deepEqual({ ...result, notes: result.notes.map(({ id: _id, ...note }) => note) },
    { ...expected, notes: expected.notes.map(({ id: _id, ...note }) => note) });
  assert.deepEqual(result.notes[0].gainEnvelope?.map(point => point.tick), [0, 1, 5]);
  assert.deepEqual(result.notes[0].pitchEnvelope?.map(point => point.pitch.millicents), [6200000, 6275000]);
  assert.equal(result.notes[0].velocity, 91);
});

test('nested fractional offsets and knot times use one exact PPQ without changing shared context time', () => {
  const expressive = note('gesture', 'lower', 1, 3, 60);
  expressive.pitchEnvelope = [{ tick: 0, pitch: { ...expressive.pitch } }, { tick: 1, pitch: { millicents: 6025000 } }];
  const base = context(); base.duration = 2; base.trackEnds = [2, 2];
  base.attachments = [{ tick: 1, track: 0, order: 0, bytes: [176, 64, 127] }];
  const result = compileComposition({ context: base, materials: [{ id: 'cell', span: 5, notes: [expressive] }],
    definitions: [{ id: 'phrase', span: 7, placements: [{ material: 'cell', onset: 1, timeScale: { numerator: 1, denominator: 3 } }] }],
    placements: [{ material: 'phrase', onset: 2, timeScale: { numerator: 1, denominator: 2 } }] });
  assert.equal(result.ppq, ppq * 6);
  assert.deepEqual([result.notes[0].onset, result.notes[0].duration, result.duration], [16, 3, 33]);
  assert.equal(result.notes[0].pitchEnvelope![1].tick, 1);
  assert.equal(result.attachments[0].tick, 6);
});

test('velocity multipliers round and clip only at final emission', () => {
  const materials: ScoreMaterial[] = [{ id: 'cell', span: 4, notes: [note('quiet', 'lower', 0, 1, 60, 5), note('loud', 'lower', 2, 1, 62, 100)] }];
  const plan: CompositionPlan = { context: context(), materials, definitions: [{ id: 'phrase', span: 4,
    placements: [{ material: 'cell', onset: 0, velocityScale: .5 }] }],
    placements: [{ material: 'phrase', onset: 0, velocityScale: 3 }] };
  assert.deepEqual(compileComposition(plan).notes.map(note => note.velocity), [8, 127]);
  plan.definitions![0].placements[0].velocityScale = 2;
  plan.placements[0].velocityScale = .5;
  assert.deepEqual(compileComposition(plan).notes.map(note => note.velocity), [5, 100], 'An intermediate loudness must not clip before a compensating transform.');
});

test('several definition levels compose offsets, transformations and routing in the same order', () => {
  const gesture = note('n', 'lower', 1, 5, 61, 83);
  gesture.gainEnvelope = [{ tick: 0, gain: .2 }, { tick: 3, gain: .9 }];
  const plan: CompositionPlan = { context: context(), materials: [{ id: 'cell', span: 12, notes: [gesture] }],
    definitions: [
      { id: 'a', span: 20, placements: [{ material: 'cell', onset: 3, timeScale: { numerator: 3, denominator: 2 },
        transposeMillicents: 100000, velocityScale: .5, partMap: { lower: 'a' } }] },
      { id: 'b', span: 30, placements: [{ material: 'a', onset: 5, timeScale: { numerator: 2, denominator: 3 },
        transposeMillicents: 200000, velocityScale: 2, partMap: { a: 'b' } }] },
      { id: 'c', span: 40, placements: [{ material: 'b', onset: 7, timeScale: { numerator: 5, denominator: 2 },
        transposeMillicents: -150000, velocityScale: .5, partMap: { b: 'c' } }] },
    ], placements: [{ material: 'c', onset: 11, timeScale: { numerator: 2, denominator: 5 },
      transposeMillicents: -150000, velocityScale: 2, partMap: { c: 'upper' } }] };
  const result = compileComposition(plan);
  // Absolute note onset = 11 + 7*(2/5) + 5 + 3*(2/3) + 1.
  // The longest nominal tail is b: 11 + 7*(2/5) + 30.
  assert.equal(result.ppq, ppq * 15);
  assert.deepEqual([result.notes[0].onset, result.notes[0].duration, result.duration], [327, 75, 657]);
  assert.equal(result.notes[0].part, 'upper');
  assert.equal(result.notes[0].pitch.millicents, gesture.pitch.millicents);
  assert.equal(result.notes[0].velocity, gesture.velocity);
  assert.deepEqual(result.notes[0].gainEnvelope, [{ tick: 0, gain: .2 }, { tick: 45, gain: .9 }]);
});

test('child nominal silence and sounding tails survive a shorter parent span', () => {
  const plan: CompositionPlan = { context: context(), materials: [
    { id: 'silence', span: 20, notes: [] },
    { id: 'tail', span: 2, notes: [note('tail', 'lower', 1, 12, 60)] },
  ], definitions: [{ id: 'phrase', span: 5, placements: [{ material: 'silence', onset: 4 }, { material: 'tail', onset: 3 }] }],
  placements: [{ material: 'phrase', onset: 0 }, { material: 'phrase', onset: 5 }] };
  const result = compileComposition(plan);
  assert.deepEqual(result.notes.map(note => note.onset), [4, 9], 'Following placement uses the explicit parent span.');
  assert.deepEqual(result.notes.map(note => note.duration), [12, 12]);
  assert.equal(result.duration, 29, 'Silent child extent remains audible as final silence.');
  assert.equal(result.trackEnds[0], 29);
});

test('unused definitions are validated for collisions, references, spans, transforms and cycles', () => {
  const base: CompositionPlan = { context: context(), materials: [{ id: 'cell', span: 2, notes: [] }], placements: [] };
  const check = (definition: NonNullable<CompositionPlan['definitions']>[number], error: RegExp) =>
    assert.throws(() => compileComposition({ ...base, definitions: [definition] }), error);
  check({ id: 'cell', span: 2, placements: [] }, /unique/);
  check({ id: 'unused', span: 0, placements: [] }, /positive integer span/);
  check({ id: 'unused', span: 2, placements: [{ material: 'missing', onset: 0 }] }, /Unknown material/);
  check({ id: 'unused', span: 2, placements: [{ material: 'cell', onset: 0, timeScale: { numerator: 1, denominator: 0 } }] }, /Invalid/);
  check({ id: 'unused', span: 2, placements: [{ material: 'cell', onset: 2 }] }, /within its nominal span/);
  check({ id: 'unused', span: 2, placements: [{ material: 'cell', onset: 0, velocityScale: NaN }] }, /Invalid/);
  check({ id: 'unused', span: 2, placements: [{ material: 'cell', onset: 0, partMap: { lower: '' } }] }, /routing/);
  assert.throws(() => compileComposition({ ...base, definitions: [
    { id: 'a', span: 2, placements: [{ material: 'b', onset: 0 }] },
    { id: 'b', span: 2, placements: [{ material: 'a', onset: 0 }] },
  ] }), /cycle/);
});

test('preflight budgets reject exponential note and empty expansion, and allow explicit bounded overrides', () => {
  const definitions = Array.from({ length: 18 }, (_, i) => ({ id: `level-${i}`, span: 2,
    placements: [0, 1].map(onset => ({ material: i ? `level-${i - 1}` : 'cell', onset })) }));
  const plan: CompositionPlan = { context: context(), materials: [{ id: 'cell', span: 2, notes: [note('n', 'lower', 0, 1, 60)] }],
    definitions, placements: [{ material: 'level-17', onset: 0 }] };
  assert.throws(() => compileComposition(plan), /note budget/);
  assert.throws(() => compileComposition({ ...plan, materials: [{ id: 'cell', span: 2, notes: [] }] }), /placement budget/);
  const small = { ...plan, definitions: definitions.slice(0, 2), placements: [{ material: 'level-1', onset: 0 }] };
  assert.throws(() => compileComposition(small, { maxExpandedNotes: 3 }), /note budget/);
  assert.equal(compileComposition(small, { maxExpandedNotes: 4, maxExpandedPlacements: 7 }).notes.length, 4);
  assert.throws(() => compileComposition({ ...small, placements: [] }, { maxDepth: 1 }), /depth budget/);
  assert.throws(() => compileComposition(small, { maxExpandedNotes: -1 }), /Invalid.*budget/);
  assert.throws(() => compileComposition({ ...small, placements: [{ material: 'level-1', onset: Number.MAX_SAFE_INTEGER }] }), /safe integer/);
});
