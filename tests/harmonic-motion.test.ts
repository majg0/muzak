import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { callCoreSync as call } from '../src/core/sync';
import { loadCore, type CoreRequest } from '../src/core/runtime';
import type { HarmonicMotionOptions } from '../src/core/generated/HarmonicMotionOptions';
import type { MotionChord } from '../src/core/generated/MotionChord';
import type { MotionCandidate } from '../src/core/generated/MotionCandidate';
import type { MotionFrame } from '../src/core/generated/MotionFrame';
import type { Score } from '../src/core/generated/Score';

const chord = (id: string, pitchesMillicents: number[], rootMillicents: number | null = pitchesMillicents[0]): MotionChord =>
  ({ id, name: id, pitchesMillicents, rootMillicents });

function frame(tonicMillicents: number): MotionFrame {
  return { id: 'center', name: 'Supplied major center', role: 'local', tonicMillicents,
    collectionOffsetsMillicents: [0, 200000, 400000, 500000, 700000, 900000, 1100000],
    targetOffsetsMillicents: [0, 400000, 700000], weight: 1 };
}

function fixture(): HarmonicMotionOptions {
  return {
    periodMillicents: 1200000,
    chords: [chord('C', [6000000, 6400000, 6700000]),
      chord('G7', [5500000, 5900000, 6200000, 6500000]),
      chord('F', [5300000, 5700000, 6000000]),
      chord('Am', [5700000, 6000000, 6400000])],
    frames: [frame(6000000)],
    history: [
      { chordId: 'C', duration: { numerator: 1, denominator: 3 } },
      { chordId: 'G7', duration: { numerator: 2, denominator: 3 } },
      { chordId: 'C', duration: { numerator: 4, denominator: 3 } },
    ],
    fromChordId: 'G7', toChordId: 'C',
    weights: { motion: 1, unmatched: 50, commonTones: 0, collectionDistance: 1,
      targetDistance: 1, targetApproach: 1, historyDistance: 1, repetition: 0 },
    tempo: 104, arpeggiate: false,
  };
}

function candidate(options: HarmonicMotionOptions, id = options.toChordId): MotionCandidate {
  const result = call('analyzeHarmonicMotion', { options }).successors.find(item => item.chordId === id);
  assert.ok(result, `The finite catalog must retain ${id}.`);
  return result;
}

function events(score: Score) {
  return score.notes.map(note => [note.onset, note.duration, note.pitch.millicents, note.velocity, note.releaseVelocity])
    .sort((a, b) => a[0] - b[0] || a[2] - b[2]);
}

test('independent finite catalogs have complete ordered atlases and executable standalone passages', () => {
  const catalogs = [{ id: 'voiced-passage', options: fixture() }];
  for (const qualities of [
    [[0, 4, 7], [0, 3, 7]],
    [[0, 4, 7], [0, 3, 7], [0, 4, 7, 10], [0, 4, 7, 11]],
  ]) {
    const options = fixture();
    options.chords = Array.from({ length: 12 }, (_, root) => qualities.map((intervals, quality) =>
      chord(`${root}-${quality}`, intervals.map(interval => 4800000 + (root + interval) * 100000)))).flat();
    options.fromChordId = '7-0'; options.toChordId = '0-0';
    options.history = ['0-0', '5-0', '2-1', '7-0', '0-0'].map(chordId =>
      ({ chordId, duration: { numerator: 2, denominator: 1 } }));
    catalogs.push({ id: `${options.chords.length}-chord-catalog`, options });
  }
  assert.deepEqual(catalogs.map(item => item.options.chords.length), [4, 24, 48]);
  for (const catalog of catalogs) {
    const { options } = catalog, saved = structuredClone(options);
    const analysis = call('analyzeHarmonicMotion', { options });
    const pairs = options.chords.flatMap(from => options.chords.map(to => `${from.id}/${to.id}`)).sort();
    assert.equal(analysis.pairCount, options.chords.length ** 2, catalog.id);
    assert.deepEqual(analysis.atlas.map(pair => `${pair.fromChordId}/${pair.toChordId}`).sort(), pairs, catalog.id);
    assert.deepEqual(analysis.successors.map(item => item.chordId).sort(), options.chords.map(item => item.id).sort());
    assert.ok(analysis.successors.every(item => Number.isFinite(item.cost)));
    assert.ok(analysis.successors.every((item, index, list) => index === 0 || list[index - 1].cost <= item.cost));
    for (const item of analysis.successors) {
      assert.ok(item.factors.every(factor => factor.value === null || Number.isFinite(factor.value)));
      assert.ok(Math.abs(item.cost - item.factors.reduce((sum, factor) => sum + factor.contribution, 0)) < 1e-8);
    }
    const plan = call('realizeHarmonicMotion', { options });
    const score = call('compileComposition', { plan });
    const expectedNotes = options.history.reduce((sum, step) =>
      sum + options.chords.find(item => item.id === step.chordId)!.pitchesMillicents.length, 0);
    assert.equal(score.notes.length, expectedNotes, catalog.id);
    assert.equal(new Set(score.notes.map(note => note.id)).size, expectedNotes);
    const scene = call('sceneFromComposition', { plan });
    assert.equal(scene.origin, 'authored');
    assert.deepEqual(call('decodeScene', { scene: JSON.parse(JSON.stringify(scene)) }), score, catalog.id);
    assert.deepEqual(options, saved, 'Analysis and realization preserve authored premises.');
  }
});

test('a flat objective retains every candidate and reports the whole ranking tie', () => {
  const options = fixture();
  for (const key of Object.keys(options.weights) as (keyof typeof options.weights)[]) options.weights[key] = 0;
  const result = call('analyzeHarmonicMotion', { options });
  assert.equal(result.successors.length, options.chords.length);
  assert.ok(result.successors.every(item => item.cost === 0 && item.rank === 1 && item.tiedCount === options.chords.length));
  assert.equal(new Set(result.successors.map(item => item.chordId)).size, options.chords.length);
});

test('unequal cardinality keeps all minimum assignments, unmatched identities and exact directed endpoints', () => {
  const options = fixture();
  options.chords = [chord('two', [6000000, 6200000]), chord('one', [6100000])];
  options.fromChordId = 'two'; options.toChordId = 'one'; options.frames = []; options.history = [];
  const result = call('analyzeHarmonicMotion', { options });
  assert.equal(result.selectedPair.totalMotionMillicents, 100000);
  assert.equal(result.selectedPair.unmatchedCount, 1);
  assert.equal(result.selectedPair.optimalCorrespondenceCount, 2);
  assert.equal(result.selectedCorrespondences.length, 2);
  const assignments = result.selectedCorrespondences.map(item => ({ links: item.links,
    departures: item.departures, arrivals: item.arrivals }));
  assert.deepEqual(assignments, [
    { links: [{ fromMember: 0, toMember: 0, fromMillicents: 6000000, toMillicents: 6100000, displacementMillicents: 100000 }], departures: [1], arrivals: [] },
    { links: [{ fromMember: 1, toMember: 0, fromMillicents: 6200000, toMillicents: 6100000, displacementMillicents: -100000 }], departures: [0], arrivals: [] },
  ]);
  const targetFrame = frame(6100000); targetFrame.collectionOffsetsMillicents = []; targetFrame.targetOffsetsMillicents = [0];
  const witnesses = candidate({ ...options, frames: [targetFrame] }).frames[0].targetWitnesses;
  assert.deepEqual(witnesses.map(item => [item.fromMember, item.toMember, item.displacementMillicents, item.optimalSupport, item.entersTarget]),
    [[0, 0, 100000, 1, true], [1, 0, -100000, 1, true]], 'Marginal link support retains both signed endpoints and their assignment counts.');
  const reversed = call('analyzeHarmonicMotion', { options: { ...options, fromChordId: 'one', toChordId: 'two' } });
  assert.equal(reversed.selectedCorrespondences.length, 2);
  assert.ok(reversed.selectedCorrespondences.every(item => item.departures.length === 0 && item.arrivals.length === 1));
  assert.deepEqual(reversed.selectedCorrespondences.map(item => item.links[0].displacementMillicents).sort((a, b) => a - b), [-100000, 100000]);

  options.chords = [chord('two', [6000000, 6000000]), chord('one', [6000000])];
  const coincident = call('analyzeHarmonicMotion', { options });
  assert.equal(coincident.selectedPair.optimalCorrespondenceCount, 2, 'Equal pitch values must not merge event identities.');
  assert.equal(coincident.selectedCorrespondences.length, 2);
  const doubled = call('realizeHarmonicMotion', { options: { ...options,
    history: [{ chordId: 'two', duration: { numerator: 1, denominator: 1 } }] } });
  doubled.harmonies!.find(item => item.id === 'two')!.intervals[1] += 12345;
  const diverged = call('compileComposition', { plan: doubled });
  assert.deepEqual(diverged.notes.map(note => note.pitch.millicents), [6000000, 6012345]);
  assert.equal(new Set(diverged.notes.map(note => note.id)).size, 2);

  options.chords = [chord('two', [6000000]), chord('one', [6600000])];
  const tritone = call('analyzeHarmonicMotion', { options });
  assert.equal(tritone.selectedCorrespondences.length, 1);
  assert.equal(tritone.selectedCorrespondences[0].links[0].displacementMillicents, 600000,
    'A declared period never substitutes a different register endpoint.');
});

test('the same G7 to C motion has different effects under supplied C and F centers', () => {
  const c = fixture(), f = structuredClone(c); f.frames = [frame(6500000)];
  const underC = call('analyzeHarmonicMotion', { options: c });
  const underF = call('analyzeHarmonicMotion', { options: f });
  assert.deepEqual(underC.selectedPair, underF.selectedPair);
  assert.deepEqual(underC.selectedCorrespondences, underF.selectedCorrespondences);
  const cEffect = underC.successors.find(item => item.chordId === 'C')!.frames[0];
  const fEffect = underF.successors.find(item => item.chordId === 'C')!.frames[0];
  assert.equal(cEffect.sourceRootOffsetMillicents, 700000);
  assert.equal(cEffect.targetRootOffsetMillicents, 0);
  assert.equal(fEffect.sourceRootOffsetMillicents, 200000);
  assert.equal(fEffect.targetRootOffsetMillicents, 700000);
  assert.equal(cEffect.targetTargetDistanceCents, 0);
  assert.equal(fEffect.targetTargetDistanceCents, 100);
  assert.ok(cEffect.targetApproachCents! > fEffect.targetApproachCents!);
  assert.notEqual(candidate(c).cost, candidate(f).cost);
});

test('history uses duration exposure while pair geometry stays fixed', () => {
  const options = fixture();
  options.chords = [chord('A', [6000000]), chord('B', [6200000])];
  options.frames = []; options.fromChordId = 'B'; options.toChordId = 'A';
  options.history = [{ chordId: 'A', duration: { numerator: 3, denominator: 1 } },
    { chordId: 'B', duration: { numerator: 1, denominator: 1 } }];
  const aLong = call('analyzeHarmonicMotion', { options });
  const changed = structuredClone(options);
  changed.history[0].duration.numerator = 1; changed.history[1].duration.numerator = 3;
  const bLong = call('analyzeHarmonicMotion', { options: changed });
  assert.deepEqual(aLong.atlas, bLong.atlas);
  assert.equal(aLong.historyQuarters, 4); assert.equal(bLong.historyQuarters, 4);
  const aCost = aLong.successors.find(item => item.chordId === 'A')!;
  const bCost = bLong.successors.find(item => item.chordId === 'A')!;
  assert.equal(aCost.factors.find(factor => factor.id === 'historyDistance')!.value, 50);
  assert.equal(bCost.factors.find(factor => factor.id === 'historyDistance')!.value, 150);
  assert.ok(aCost.cost < bCost.cost, 'Longer exposure to B makes a return to A more distant under the stated history objective.');
  assert.equal(bCost.cost - aCost.cost, 1, 'Distance weights charge per 100 cents.');
  assert.equal(aLong.path[0].historyQuarters, 3);
  assert.equal(bLong.path[0].historyQuarters, 1);
  assert.equal(aLong.path[0].effect.factors.find(factor => factor.id === 'historyDistance')!.value, 200);
  assert.equal(bLong.path[0].effect.factors.find(factor => factor.id === 'historyDistance')!.value, 200,
    'A path transition uses its source-inclusive prefix, never the duration of the future candidate.');
});

test('joint transposition of chords and centers preserves contextual results and translates endpoints', () => {
  const original = fixture(), transposed = structuredClone(original), delta = 12345;
  for (const item of transposed.chords) {
    item.pitchesMillicents = item.pitchesMillicents.map(pitch => pitch + delta);
    if (item.rootMillicents !== null) item.rootMillicents += delta;
  }
  for (const item of transposed.frames) item.tonicMillicents += delta;
  const before = call('analyzeHarmonicMotion', { options: original });
  const after = call('analyzeHarmonicMotion', { options: transposed });
  const shiftedBack = JSON.parse(JSON.stringify(after), (key, value: unknown) =>
    (key === 'fromMillicents' || key === 'toMillicents') && typeof value === 'number' ? value - delta : value);
  // Compare through the same JSON round trip on both sides: JS JSON.stringify
  // normalizes IEEE signed zero, independently of musical transposition.
  assert.deepEqual(shiftedBack, JSON.parse(JSON.stringify(before)));
  const first = call('compileComposition', { plan: call('realizeHarmonicMotion', { options: original }) });
  const second = call('compileComposition', { plan: call('realizeHarmonicMotion', { options: transposed }) });
  assert.deepEqual(events(second).map(row => [row[0], row[1], row[2] - delta, row[3], row[4]]), events(first));
});

test('relative modal centers distinguish a return while retaining the same collection fit', () => {
  const options = fixture();
  const aeolian = frame(5700000);
  aeolian.id = 'aeolian'; aeolian.name = 'A Aeolian';
  aeolian.collectionOffsetsMillicents = [0, 200000, 300000, 500000, 700000, 800000, 1000000];
  aeolian.targetOffsetsMillicents = [0, 300000, 700000];
  options.frames.push(aeolian);
  options.fromChordId = 'C'; options.toChordId = 'Am';
  const result = call('analyzeHarmonicMotion', { options });
  const [major, modal] = result.successors.find(item => item.chordId === 'Am')!.frames;
  assert.equal(major.sourceCollectionDistanceCents, modal.sourceCollectionDistanceCents);
  assert.equal(major.targetCollectionDistanceCents, modal.targetCollectionDistanceCents);
  assert.equal(major.targetRootOffsetMillicents, 900000);
  assert.equal(modal.targetRootOffsetMillicents, 0);
  assert.ok(major.targetApproachCents! < 0);
  assert.ok(modal.targetApproachCents! > 0);
  const reverse = result.atlas.find(pair => pair.fromChordId === 'Am' && pair.toChordId === 'C')!;
  assert.equal(result.selectedPair.totalMotionMillicents, reverse.totalMotionMillicents);
  assert.equal(result.selectedPair.rootDisplacementMillicents, -300000);
  assert.equal(reverse.rootDisplacementMillicents, 300000);
});

test('the 24-triad atlas admits exactly one inverse for each P, L and R operation', () => {
  const options = fixture();
  options.chords = Array.from({ length: 12 }, (_, root) => [
    chord(`major-${root}`, [0, 400000, 700000].map(interval => 6000000 + root * 100000 + interval)),
    chord(`minor-${root}`, [0, 300000, 700000].map(interval => 6000000 + root * 100000 + interval)),
  ]).flat();
  options.fromChordId = 'major-0'; options.toChordId = 'minor-0'; options.frames = []; options.history = [];
  const result = call('analyzeHarmonicMotion', { options });
  assert.equal(result.pairCount, 576);
  for (const source of options.chords) {
    for (const operation of ['P', 'L', 'R']) {
      const forward = result.atlas.filter(pair => pair.fromChordId === source.id && pair.triadicTransforms.includes(operation));
      assert.equal(forward.length, 1, `${source.id} ${operation}`);
      const reverse = result.atlas.find(pair => pair.fromChordId === forward[0].toChordId && pair.toChordId === source.id)!;
      assert.ok(reverse.triadicTransforms.includes(operation));
    }
  }
  for (const [operation, target] of [['P', 'minor-0'], ['L', 'minor-4'], ['R', 'minor-9']]) {
    assert.deepEqual(result.atlas.find(pair => pair.fromChordId === 'major-0' && pair.toChordId === target)!.triadicTransforms, [operation]);
  }
  const cycle = result.atlas.find(pair => pair.fromChordId === 'major-0' && pair.toChordId === 'major-4')!;
  assert.equal(cycle.rootCycleOrder, 3);
});

test('a period preserves common classes without erasing register motion', () => {
  const options = fixture();
  options.chords = [chord('low', [6000000, 6400000, 6700000]), chord('high', [7200000, 7600000, 7900000])];
  options.fromChordId = 'low'; options.toChordId = 'high'; options.frames = []; options.history = [];
  const periodic = call('analyzeHarmonicMotion', { options }).selectedPair;
  assert.equal(periodic.commonToneCount, 3);
  assert.equal(periodic.totalMotionMillicents, 3600000);
  assert.equal(periodic.rootDisplacementMillicents, 1200000);
  assert.equal(periodic.rootModuloMillicents, 0);
  const absolute = call('analyzeHarmonicMotion', { options: { ...options, periodMillicents: null } }).selectedPair;
  assert.equal(absolute.commonToneCount, 0);
  assert.equal(absolute.totalMotionMillicents, periodic.totalMotionMillicents);
  assert.equal(absolute.rootModuloMillicents, null);
});

test('absent centers, collections, roots and periods remain explicitly unknown', () => {
  const options = fixture();
  options.frames = []; options.history = []; options.periodMillicents = null;
  for (const item of options.chords) item.rootMillicents = null;
  const result = call('analyzeHarmonicMotion', { options });
  assert.ok(result.historyQuarters === 0, 'Empty history has zero exposure (either IEEE zero sign).');
  assert.deepEqual(result.path, []);
  const silent = call('compileComposition', { plan: call('realizeHarmonicMotion', { options }) });
  assert.deepEqual(silent.notes, []);
  assert.equal(silent.duration, 0);
  assert.equal(call('scoreMeter', { score: silent }).toTick, 0);
  assert.ok(result.atlas.every(pair => pair.rootDisplacementMillicents === null
    && pair.rootModuloMillicents === null && pair.rootCycleOrder === null));
  assert.ok(result.successors.every(item => item.frames.length === 0 && item.factors.some(factor => factor.value === null)));
  const empty = frame(6000000); empty.collectionOffsetsMillicents = []; empty.targetOffsetsMillicents = [];
  options.frames = [empty];
  const effect = candidate(options).frames[0];
  assert.equal(effect.sourceRootOffsetMillicents, null);
  assert.equal(effect.targetRootOffsetMillicents, null);
  assert.equal(effect.sourceCollectionDistanceCents, null);
  assert.equal(effect.targetCollectionDistanceCents, null);
  assert.equal(effect.sourceTargetDistanceCents, null);
  assert.equal(effect.targetTargetDistanceCents, null);
  assert.equal(effect.targetApproachCents, null);
  assert.deepEqual(effect.targetWitnesses, []);
});

test('19-EDO and a nonoctave period keep exact supplied native pitches through the compiler', () => {
  for (const [period, intervals] of [[1200000, [0, 378947, 694737]], [1901955, [0, 467991, 1091908]]] as const) {
    const options = fixture();
    options.periodMillicents = period;
    options.chords = [chord('x', intervals.map(interval => 6000000 + interval)),
      chord('y', intervals.map(interval => 6137217 + interval))];
    options.frames = []; options.fromChordId = 'x'; options.toChordId = 'y';
    options.history = [{ chordId: 'x', duration: { numerator: 1, denominator: 3 } },
      { chordId: 'y', duration: { numerator: 2, denominator: 3 } }];
    const analysis = call('analyzeHarmonicMotion', { options });
    assert.equal(analysis.selectedPair.rootDisplacementMillicents, 137217);
    assert.ok(analysis.atlas.every(pair => !pair.triadicAdapterEligible));
    const plan = call('realizeHarmonicMotion', { options });
    const score = call('compileComposition', { plan });
    assert.deepEqual(score.notes.map(note => note.pitch.millicents).sort((a, b) => a - b),
      options.chords.flatMap(item => item.pitchesMillicents).sort((a, b) => a - b));
    assert.equal(score.duration / score.ppq, 1);
    const scene = call('sceneFromComposition', { plan });
    assert.deepEqual(call('decodeScene', { scene: JSON.parse(JSON.stringify(scene)) }), score);
    assert.throws(() => call('exportScoreMidi', { score }), /pitch|MIDI|millicent/i);
  }
});

test('shared palette edits regenerate repeated occurrences while a step replacement stays local', () => {
  for (const arpeggiate of [false, true]) {
    const options = fixture(); options.arpeggiate = arpeggiate;
    const plan = call('realizeHarmonicMotion', { options }), saved = structuredClone(plan);
    const original = call('compileComposition', { plan });
    assert.equal(original.duration / original.ppq, 7 / 3);
    assert.equal(plan.placements[0].material, plan.placements[2].material);
    const edited = structuredClone(plan), palette = edited.harmonies!.find(item => item.id === 'C')!;
    assert.ok(palette); palette.rootMillicents += 31250;
    const shared = call('compileComposition', { plan: edited });
    assert.equal(shared.notes.length, original.notes.length);
    for (let index = 0; index < original.notes.length; index++) {
      const before = original.notes[index], after = shared.notes[index];
      const secondStep = before.onset >= original.ppq / 3 && before.onset < original.ppq;
      assert.equal(after.pitch.millicents - before.pitch.millicents, secondStep ? 0 : 31250);
      assert.deepEqual({ ...after, pitch: before.pitch }, before, 'Pitch editing keeps identity, rhythm and performance.');
    }
    const replacement = structuredClone(options); replacement.history[2].chordId = 'Am';
    const local = call('compileComposition', { plan: call('realizeHarmonicMotion', { options: replacement }) });
    assert.deepEqual(local.notes.filter(note => note.onset < local.ppq), original.notes.filter(note => note.onset < original.ppq));
    assert.deepEqual(local.notes.filter(note => note.onset >= local.ppq).map(note => note.pitch.millicents).sort((a, b) => a - b),
      options.chords.find(item => item.id === 'Am')!.pitchesMillicents);
    assert.deepEqual(local.notes.map(note => [note.onset, note.duration]), original.notes.map(note => [note.onset, note.duration]));
    assert.deepEqual(plan, saved);
  }
});

test('eight-member arpeggios retain rational attack and gate coordinates without truncation', () => {
  const options = fixture();
  options.chords = [chord('eight', Array.from({ length: 8 }, (_, index) => 4800000 + index * 200000))];
  options.fromChordId = 'eight'; options.toChordId = 'eight'; options.frames = []; options.arpeggiate = true;
  options.history = [{ chordId: 'eight', duration: { numerator: 1, denominator: 7 } }];
  const score = call('compileComposition', { plan: call('realizeHarmonicMotion', { options }) });
  assert.equal(score.notes.length, 8);
  assert.equal(score.duration * 7, score.ppq);
  for (let member = 0; member < 8; member++) {
    const note = score.notes[member];
    assert.equal(note.onset * 8 * 7, member * score.ppq);
    assert.equal(note.duration * 10 * 8 * 7, 9 * score.ppq, 'The declared 9/10 gate is exact for every member.');
  }
});

test('an ordinary semitone passage with small rational subdivisions exports losslessly', () => {
  const options = fixture();
  options.history = [{ chordId: 'C', duration: { numerator: 1, denominator: 16 } },
    { chordId: 'G7', duration: { numerator: 3, denominator: 16 } }];
  const score = call('compileComposition', { plan: call('realizeHarmonicMotion', { options }) });
  assert.equal(score.duration * 4, score.ppq);
  const bytes = call('exportScoreMidi', { score });
  const imported = call('importMidi', { bytes }).score;
  assert.deepEqual(events(imported), events(score));
  assert.equal(imported.ppq, score.ppq);
  assert.equal(imported.duration, score.duration);
  const equivalent = structuredClone(options);
  equivalent.history[0].duration = { numerator: 64, denominator: 1024 };
  const same = call('compileComposition', { plan: call('realizeHarmonicMotion', { options: equivalent }) });
  const midi = call('importMidi', { bytes: call('exportScoreMidi', { score: same }) }).score;
  const musicalTime = (value: Score) => events(value).map(row => [row[0] / value.ppq, row[1] / value.ppq, ...row.slice(2)]);
  assert.deepEqual(musicalTime(same), musicalTime(score));
  assert.deepEqual(musicalTime(midi), musicalTime(score));
});

test('unknown chord addresses and invalid bounded inputs fail before partial output', () => {
  const invalid: HarmonicMotionOptions[] = [];
  const source = fixture(); source.fromChordId = 'missing'; invalid.push(source);
  const target = fixture(); target.toChordId = 'missing'; invalid.push(target);
  const history = fixture(); history.history[1].chordId = 'missing'; invalid.push(history);
  const duration = fixture(); duration.history[0].duration.denominator = 0; invalid.push(duration);
  const duplicate = fixture(); duplicate.chords.push(structuredClone(duplicate.chords[0])); invalid.push(duplicate);
  const members = fixture(); members.chords[0].pitchesMillicents = Array.from({ length: 9 }, (_, index) => 6000000 + index); invalid.push(members);
  const period = fixture(); period.periodMillicents = 0; invalid.push(period);
  const pitch = fixture(); pitch.chords[0].pitchesMillicents[0] = Number.MAX_SAFE_INTEGER + 1; invalid.push(pitch);
  for (const options of invalid) {
    assert.throws(() => call('analyzeHarmonicMotion', { options }), /invalid|unknown|duplicate|unique|safe|bounded|member|duration|period|chord/i);
    assert.throws(() => call('realizeHarmonicMotion', { options }), /invalid|unknown|duplicate|unique|safe|bounded|member|duration|period|chord/i);
  }
});

test('native and Wasm expose the same harmonic study, passage and strict rejection', async () => {
  const executable = resolve('target/debug', process.platform === 'win32' ? 'muzak-core.exe' : 'muzak-core');
  assert.ok(existsSync(executable), 'Build the native and Wasm core before parity checks.');
  const options = fixture(), plan = call('realizeHarmonicMotion', { options });
  const scene = call('sceneFromComposition', { plan });
  const microtonal = structuredClone(plan); microtonal.harmonies![0].rootMillicents += 1;
  const score = call('compileComposition', { plan: microtonal });
  const requests: CoreRequest[] = [
    { op: 'analyzeHarmonicMotion', input: { options } },
    { op: 'realizeHarmonicMotion', input: { options } },
    { op: 'compileComposition', input: { plan } },
    { op: 'decodeScene', input: { scene: JSON.parse(JSON.stringify(scene)) } },
    { op: 'exportScoreMidi', input: { score } },
    { op: 'analyzeHarmonicMotion', input: { options: { ...options, toChordId: 'missing' } } },
  ];
  const native: unknown[] = execFileSync(executable, [], { input: requests.map(request => JSON.stringify(request)).join('\n') + '\n',
    encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }).trim().split(/\r?\n/).map(line => JSON.parse(line));
  const runtime = await loadCore();
  const wasm = requests.map(request => {
    try { return { response: runtime.call(request) }; }
    catch (error) { return { error: { code: (error as { code: string }).code, message: (error as Error).message } }; }
  });
  assert.deepEqual(wasm, native);
});
