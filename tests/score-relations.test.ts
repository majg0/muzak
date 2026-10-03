import test from 'node:test';
import assert from 'node:assert/strict';
import { compileComposition, type CompositionPlan } from '../src/score/composition';
import type { PitchBinding } from '../src/core/generated/PitchBinding';
import { callCoreSync } from '../src/core/sync';
import type { CoreInput } from '../src/core/runtime';
import type { Score } from '../src/score/score';

const literal = (pitch: number): PitchBinding => ({ kind: 'literal', millicents: pitch * 100000 });
const passing = (lattice = 'white'): PitchBinding => ({
  kind: 'latticePath', lattice, from: { kind: 'event', index: 0 }, to: { kind: 'event', index: 2 },
  numerator: 1, denominator: 2, degreeOffset: 0, residualMillicents: 0,
});

// These expectations are authored independently of the inference algorithm.
// The supplied ordered domain is an input condition, not an inferred key.
function fixture(): CompositionPlan {
  return {
    context: { ppq: 12, duration: 60, trackEnds: [60, 60], parts: [
      { id: 'upper', name: 'Upper', track: 0, channel: 0, percussion: false },
      { id: 'lower', name: 'Lower', track: 1, channel: 1, percussion: false },
    ], attachments: [
      { tick: 0, track: 0, order: 0, bytes: [255, 88, 4, 7, 3, 24, 8] },
      { tick: 21, track: 0, order: 1, bytes: [255, 88, 4, 5, 3, 24, 8] },
      { tick: 5, track: 1, order: 0, bytes: [177, 64, 127] },
    ] },
    pitchLattices: [{ id: 'white', originMillicents: 0, periodMillicents: 1200000,
      intervals: [0, 200000, 400000, 500000, 700000, 900000, 1100000] }],
    materials: [
      { id: 'cell', span: 18, notes: [[0, 6], [6, 3], [9, 9]].map(([onset, duration], i) => ({
        id: `arbitrary-${i}`, part: 'upper', onset, duration, pitch: { millicents: 0 },
        velocity: 70 + i * 7, releaseVelocity: 31 + i,
        pitchEnvelope: [{ tick: 0, pitch: { millicents: 0 } }, { tick: 1, pitch: { millicents: i * 3125 } }],
        gainEnvelope: [{ tick: 0, gain: .8 }, { tick: duration, gain: .3 }],
      })) },
      { id: 'independent', span: 54, notes: [{ id: 'other', part: 'lower', onset: 2, duration: 51,
        pitch: { millicents: 4312500 }, velocity: 61, releaseVelocity: 9 }] },
    ],
    placements: [
      { material: 'cell', onset: 0, pitchBindings: [literal(60), literal(62), literal(64)] },
      { material: 'cell', onset: 24, pitchBindings: [literal(65), literal(67), literal(69)] },
      { material: 'independent', onset: 0 },
    ],
  };
}

test('an explicit two-anchor relation roundtrips standalone with native curves, rhythm, context and unrelated polyphony', () => {
  const source = fixture(), snapshot = structuredClone(source);
  const expected = compileComposition(source), program = structuredClone(source);
  for (const placement of program.placements.slice(0, 2)) placement.pitchBindings![1] = passing();
  assert.deepEqual(compileComposition(JSON.parse(JSON.stringify(program))), expected);
  assert.deepEqual(source, snapshot);

  // Count the complete executable payload, including the shared domain and all
  // literal anchors. A useful counterfactual edit is not automatically compression.
  const baseline = structuredClone(source); delete baseline.pitchLattices;
  assert.ok(Buffer.byteLength(JSON.stringify(program)) > Buffer.byteLength(JSON.stringify(baseline)),
    'This tiny explicit relation costs more serialized bytes than literal bindings.');
});

test('withheld harmonic/domain realization changes the dependent degree where frozen literal, transpose and palette baselines fail', () => {
  const original = fixture(), program = structuredClone(original);
  for (const placement of program.placements.slice(0, 2)) placement.pitchBindings![1] = passing();
  const before = compileComposition(program);
  program.pitchLattices!.push({ id: 'a-phrygian', originMillicents: 900000,
    periodMillicents: 1200000, intervals: [0, 100000, 300000, 500000, 700000, 800000, 1000000] });
  program.placements[1].pitchBindings = [literal(69), passing('a-phrygian'), literal(72)];
  const changed = compileComposition(program);
  const upper = changed.notes.filter(n => n.part === 'upper');
  assert.deepEqual(upper.map(n => n.pitch.millicents / 100000), [60, 62, 64, 69, 70, 72]);
  assert.deepEqual(changed.notes.filter(n => n.part === 'lower'), before.notes.filter(n => n.part === 'lower'));
  assert.deepEqual(upper.slice(0, 3), before.notes.filter(n => n.part === 'upper').slice(0, 3));
  for (let i = 0; i < changed.notes.length; i++) {
    const old = before.notes[i], next = changed.notes[i];
    assert.deepEqual([next.onset, next.duration, next.velocity, next.releaseVelocity, next.part, next.gainEnvelope],
      [old.onset, old.duration, old.velocity, old.releaseVelocity, old.part, old.gainEnvelope]);
    assert.deepEqual(next.pitchEnvelope?.map(p => [p.tick, p.pitch.millicents - next.pitch.millicents]),
      old.pitchEnvelope?.map(p => [p.tick, p.pitch.millicents - old.pitch.millicents]));
  }
  assert.deepEqual(changed.attachments, before.attachments);
  assert.deepEqual(changed.trackEnds, before.trackEnds);

  const target = [69, 70, 72];
  assert.notDeepEqual([65, 67, 69], target, 'Literal copy has no dependent edit.');
  assert.notDeepEqual([65, 67, 69].map(p => p + 4), target, 'A uniform transpose cannot change interval structure.');
  const palette = fixture();
  palette.harmonies = [{ id: 'chord', rootMillicents: 500000, intervals: [0, 400000, 700000, 200000] }];
  palette.placements[1].pitchBindings = [
    { kind: 'harmony', harmony: 'chord', tone: 0, octave: 5, residualMillicents: 0 },
    { kind: 'harmony', harmony: 'chord', tone: 3, octave: 5, residualMillicents: 0 },
    { kind: 'harmony', harmony: 'chord', tone: 1, octave: 5, residualMillicents: 0 },
  ];
  assert.deepEqual(compileComposition(palette), compileComposition(original));
  palette.harmonies[0] = { id: 'chord', rootMillicents: 900000, intervals: [0, 300000, 700000, 200000] };
  assert.deepEqual(compileComposition(palette).notes.filter(n => n.part === 'upper').slice(3).map(n => n.pitch.millicents / 100000), [69, 71, 72]);
});

test('shared domain edits propagate through references while rational transforms preserve relative native trajectories', () => {
  const plan = fixture();
  for (const placement of plan.placements.slice(0, 2)) placement.pitchBindings![1] = passing();
  plan.pitchLattices![0].intervals[1] = 100000;
  plan.pitchLattices![0].intervals[4] = 600000;
  const cellPlacements = plan.placements.splice(0, 2);
  plan.definitions = [{ id: 'phrase', span: 48, placements: cellPlacements }];
  plan.placements.unshift({ material: 'phrase', onset: 0, transposeMillicents: 37,
    timeScale: { numerator: 2, denominator: 3 } });
  const output = compileComposition(plan), upper = output.notes.filter(n => n.part === 'upper');
  assert.deepEqual(upper.map(n => n.pitch.millicents), [6000037, 6100037, 6400037, 6500037, 6600037, 6900037]);
  assert.deepEqual(upper.map(n => [n.onset / output.ppq, n.duration / output.ppq]),
    [[0, 1/3], [1/3, 1/6], [1/2, 1/2], [4/3, 1/3], [5/3, 1/6], [11/6, 1/2]]);
  assert.equal(upper[1].pitchEnvelope![1].tick / output.ppq, 1/18);
  assert.equal(upper[1].pitchEnvelope![1].pitch.millicents - upper[1].pitch.millicents, 3125);
});

type RelationInput = CoreInput<'inferPitchRelations'>;
function relationInput(): RelationInput {
  const harmony = (id: string, tone: number): PitchBinding => ({ kind: 'harmony', harmony: id,
    tone, octave: 5, residualMillicents: 0 });
  return {
    material: { id: 'two-realizations', span: 14,
      notes: [0, 2, 4, 8, 10, 12].map((onset, i) => ({ id: `witness-${i}`, part: 'upper',
        onset, duration: 2, pitch: { millicents: 0 }, velocity: 74 + i, releaseVelocity: 30,
        gainEnvelope: [{ tick: 0, gain: .9 }, { tick: 2, gain: .4 }],
      })) },
    harmonies: [
      { id: 'c', rootMillicents: 0, intervals: [0, 400000, 700000] },
      { id: 'g', rootMillicents: 700000, intervals: [0, 400000, 700000] },
    ],
    bindings: [harmony('c', 1), literal(65), harmony('c', 2), harmony('g', 1), literal(72), harmony('g', 2)],
    domains: [{ lattice: fixture().pitchLattices![0], source: 'supplied' }],
    anchorIndices: [0, 2, 3, 5],
  };
}
function relationPlan(input: RelationInput, bindings = input.bindings): CompositionPlan {
  return { context: fixture().context, materials: [input.material], harmonies: input.harmonies,
    pitchLattices: input.domains.map(d => d.lattice),
    placements: [{ material: input.material.id, onset: 0, pitchBindings: bindings }] };
}

function doubledInput(): RelationInput {
  const input = relationInput();
  const first = input.material.notes.slice(0, 3), bindings = input.bindings.slice(0, 3);
  input.material.notes = [...first, ...first.map(n => ({ ...structuredClone(n), id: `doubled-${n.id}`, part: 'lower' }))];
  input.material.span = 6;
  input.bindings = [...bindings, ...structuredClone(bindings)];
  input.anchorIndices = [0, 2, 3, 5];
  return input;
}

test('exact doubled observations select shared value anchors without deleting notes or choosing a representative event', () => {
  for (const base of [0, 1200000]) {
    const input = doubledInput();
    input.material.notes.forEach(n => { n.pitch.millicents = base; });
    const snapshot = structuredClone(input), result = callCoreSync('inferPitchRelations', input);
    assert.deepEqual(result.selectedCandidateIndices.map(i => result.candidates[i].noteIndex).sort((a, b) => a - b), [1, 4]);
    for (const index of result.selectedCandidateIndices) {
      const candidate = result.candidates[index];
      assert.deepEqual([...candidate.fromIndices].sort((a, b) => a - b), [0, 3]);
      assert.deepEqual([...candidate.toIndices].sort((a, b) => a - b), [2, 5]);
      assert.equal(candidate.binding.kind, 'latticePath');
      if (candidate.binding.kind !== 'latticePath') throw new Error('Expected an executable pitch path.');
      assert.equal(candidate.binding.from.kind, 'harmony');
      assert.equal(candidate.binding.to.kind, 'harmony');
    }
    const plan = relationPlan(input, result.bindings), source = compileComposition(relationPlan(input));
    const reconstructed = compileComposition(JSON.parse(JSON.stringify(plan)));
    assert.equal(reconstructed.notes.length, 6, 'Quotient observations guide inference; they do not collapse emitted notes.');
    assert.deepEqual(reconstructed, source);
    assert.deepEqual(input, snapshot);

    // Equal values are shared by their declared palette address, not by whichever
    // source event happened to sort first. Replacing one event binding cannot
    // silently redirect the already-declared value-level dependent bindings.
    const eventEdit = structuredClone(plan);
    eventEdit.placements[0].pitchBindings![0] = literal(72);
    const eventChanged = compileComposition(eventEdit);
    const editedId = `placement-0:${input.material.id}:0`;
    assert.deepEqual(eventChanged.notes.filter(n => n.id !== editedId), source.notes.filter(n => n.id !== editedId));

    plan.harmonies![0] = { id: 'c', rootMillicents: 900000, intervals: [0, 300000, 700000] };
    const changed = compileComposition(plan);
    for (const part of ['upper', 'lower']) {
      assert.deepEqual(changed.notes.filter(n => n.part === part).map(n => n.pitch.millicents / 100000),
        [72, 74, 76].map(n => n + base / 100000));
    }
  }
});

test('doubled relation witnesses are invariant under source identity, order and part repartition', () => {
  const source = doubledInput(), changed = structuredClone(source), order = [4, 0, 5, 2, 1, 3];
  changed.material.notes = order.map((i, j) => ({ ...structuredClone(source.material.notes[i]),
    id: `new-${91 - j}`, part: j % 2 ? 'upper' : 'lower' }));
  changed.bindings = order.map(i => source.bindings[i]);
  changed.anchorIndices = source.anchorIndices.map(i => order.indexOf(i));
  const result = callCoreSync('inferPitchRelations', changed);
  assert.equal(result.selectedCandidateIndices.length, 2);
  for (const i of result.selectedCandidateIndices) {
    const candidate = result.candidates[i];
    assert.equal(changed.material.notes[candidate.noteIndex].onset, 2);
    assert.equal(candidate.fromIndices.length, 2);
    assert.equal(candidate.toIndices.length, 2);
    assert.ok(candidate.fromIndices.every(j => changed.material.notes[j].onset === 0));
    assert.ok(candidate.toIndices.every(j => changed.material.notes[j].onset === 4));
    assert.equal(candidate.binding.kind, 'latticePath');
    if (candidate.binding.kind === 'latticePath') {
      assert.equal(candidate.binding.from.kind, 'harmony');
      assert.equal(candidate.binding.to.kind, 'harmony');
    }
  }
  assert.deepEqual(compileComposition(relationPlan(changed, result.bindings)), compileComposition(relationPlan(changed)));
});

test('identical pitches with distinct palette addresses remain ambiguous and independently editable', () => {
  const input = doubledInput();
  input.harmonies.push({ ...structuredClone(input.harmonies[0]), id: 'independent-c' });
  for (const i of [3, 5]) {
    const binding = input.bindings[i];
    assert.equal(binding.kind, 'harmony');
    if (binding.kind === 'harmony') binding.harmony = 'independent-c';
  }
  const result = callCoreSync('inferPitchRelations', input);
  assert.deepEqual(result.selectedCandidateIndices, [], 'Source equality does not establish shared edit semantics.');
  assert.deepEqual(result.bindings, input.bindings);
  assert.ok(result.candidates.length > 0, 'Competing interpretations remain evidence instead of disappearing.');
  const plan = relationPlan(input, result.bindings), before = compileComposition(plan);
  plan.harmonies![0] = { id: 'c', rootMillicents: 900000, intervals: [0, 300000, 700000] };
  const after = compileComposition(plan);
  assert.deepEqual(after.notes.filter(n => n.part === 'lower'), before.notes.filter(n => n.part === 'lower'));
  assert.deepEqual(after.notes.filter(n => n.part === 'upper').map(n => n.pitch.millicents / 100000), [72, 65, 76]);
});

test('local material occurrence edits preserve declared sharing across doubled value-level relations', () => {
  const input = doubledInput(), result = callCoreSync('inferPitchRelations', input);
  const plan = relationPlan(input, result.bindings);
  plan.placements.push({ ...structuredClone(plan.placements[0]), onset: 12 });
  const before = compileComposition(plan);
  plan.placements[1].transposeMillicents = 1200000;
  const local = compileComposition(plan);
  assert.deepEqual(local.notes.slice(0, 6), before.notes.slice(0, 6));
  assert.deepEqual(local.notes.slice(6).map(n => n.pitch.millicents), before.notes.slice(6).map(n => n.pitch.millicents + 1200000));
  plan.pitchLattices![0].intervals[3] = 600000; // A shared degree edit F -> F-sharp affects both copies.
  const shared = compileComposition(plan);
  for (const part of ['upper', 'lower']) {
    assert.deepEqual(shared.notes.filter(n => n.part === part).map(n => n.pitch.millicents / 100000),
      [64, 66, 67, 76, 78, 79]);
  }
  assert.deepEqual(shared.notes.map(n => [n.onset, n.duration, n.part, n.velocity, n.gainEnvelope]),
    local.notes.map(n => [n.onset, n.duration, n.part, n.velocity, n.gainEnvelope]));
});

test('inference selects two exact supplied-domain relations then realizes an unseen anchor change', () => {
  const input = relationInput(), snapshot = structuredClone(input);
  const analysis = callCoreSync('inferPitchRelations', input);
  assert.deepEqual(analysis.selectedCandidateIndices.map(i => analysis.candidates[i].noteIndex).sort((a, b) => a - b), [1, 4]);
  assert.ok(analysis.selectedCandidateIndices.every(i => analysis.candidates[i].exactMatch));
  const program = relationPlan(input, analysis.bindings), source = compileComposition(relationPlan(input));
  assert.deepEqual(compileComposition(JSON.parse(JSON.stringify(program))), source);
  assert.deepEqual(input, snapshot);
  assert.equal(analysis.costs.originalBindingsJsonBytes, Buffer.byteLength(JSON.stringify(input.bindings)));
  assert.equal(analysis.costs.rewrittenBindingsJsonBytes, Buffer.byteLength(JSON.stringify(analysis.bindings)));
  assert.equal(analysis.costs.originalRequiredLatticesJsonBytes, Buffer.byteLength(JSON.stringify([])));
  assert.equal(analysis.costs.rewrittenRequiredLatticesJsonBytes, Buffer.byteLength(JSON.stringify(input.domains.map(d => d.lattice))));
  const existing = callCoreSync('inferPitchRelations', { ...input, bindings: analysis.bindings });
  assert.deepEqual(existing.selectedCandidateIndices, []);
  assert.equal(existing.costs.originalRequiredLatticesJsonBytes, analysis.costs.rewrittenRequiredLatticesJsonBytes);
  assert.equal(existing.costs.rewrittenRequiredLatticesJsonBytes, existing.costs.originalRequiredLatticesJsonBytes,
    'A previously selected relation still requires its lattice even when this call adds no candidate.');
  program.harmonies![0] = { id: 'c', rootMillicents: 900000, intervals: [0, 300000, 700000] };
  const changed = compileComposition(program);
  assert.deepEqual(changed.notes.map(n => n.pitch.millicents / 100000), [72, 74, 76, 71, 72, 74]);
  assert.deepEqual(changed.notes.slice(3), source.notes.slice(3));
  assert.deepEqual(changed.notes.map(n => [n.onset, n.duration, n.gainEnvelope, n.velocity, n.part]),
    source.notes.map(n => [n.onset, n.duration, n.gainEnvelope, n.velocity, n.part]));
});

test('a relation crosses harmonic contexts and both independently editable anchors remain exact dependencies', () => {
  const same = relationInput();
  same.material.notes = same.material.notes.slice(0, 3); same.material.span = 6;
  same.bindings = same.bindings.slice(0, 3); same.anchorIndices = [0, 2];
  const separate = structuredClone(same);
  separate.bindings[2] = { kind: 'harmony', harmony: 'g', tone: 0, octave: 5, residualMillicents: 0 };
  const source = compileComposition(relationPlan(same));
  assert.deepEqual(compileComposition(relationPlan(separate)), source);
  const one = callCoreSync('inferPitchRelations', same), two = callCoreSync('inferPitchRelations', separate);
  const selected = (result: typeof one) => result.selectedCandidateIndices.map(i => {
    const c = result.candidates[i]; return [c.noteIndex, c.fromIndices, c.toIndices, c.kind, c.domainId, c.binding];
  });
  assert.equal(one.selectedCandidateIndices.length, 1);
  assert.deepEqual(selected(two), selected(one), 'Changing palette identity without changing observed music cannot remove a relation.');
  const plan = relationPlan(separate, two.bindings);
  assert.deepEqual(compileComposition(JSON.parse(JSON.stringify(plan))), source);
  const pitches = () => compileComposition(plan).notes.map(n => n.pitch.millicents / 100000);

  plan.harmonies![1].rootMillicents = 1100000; // Change only the right anchor: G -> B.
  assert.deepEqual(pitches(), [64, 67, 71]);
  plan.harmonies![0].rootMillicents = 300000; // Then change only the left: E -> G.
  assert.deepEqual(pitches(), [67, 69, 71]);
  assert.deepEqual(compileComposition(plan).notes.map(n => [n.onset, n.duration, n.velocity, n.releaseVelocity, n.gainEnvelope]),
    source.notes.map(n => [n.onset, n.duration, n.velocity, n.releaseVelocity, n.gainEnvelope]));

  plan.harmonies![1].rootMillicents = 900000; // G and A are one degree apart: half a degree is not a note.
  assert.throws(() => compileComposition(plan), /integer|fraction|degree|lattice/i);
  plan.harmonies![1].rootMillicents = 100000; // C-sharp is absent from the declared domain.
  assert.throws(() => compileComposition(plan), /lattice|domain/i);
});

test('tiny independent exhaustive oracle distinguishes passing/neighbor geometry from unsupported triples', () => {
  let accepted = 0;
  for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) for (let c = 0; c < 3; c++) {
    const input = relationInput();
    input.material.notes = input.material.notes.slice(0, 3); input.material.span = 6;
    input.harmonies = [{ id: 'c', rootMillicents: 0, intervals: [0, 200000, 400000] }];
    input.anchorIndices = [0, 2];
    input.bindings = [
      { kind: 'harmony', harmony: 'c', tone: a, octave: 5, residualMillicents: 0 }, literal(60 + b * 2),
      { kind: 'harmony', harmony: 'c', tone: c, octave: 5, residualMillicents: 0 },
    ];
    const expected = (a !== c && Math.abs(a - c) === 2 && 2 * b === a + c)
      || (a === c && Math.abs(b - a) === 1);
    const result = callCoreSync('inferPitchRelations', input);
    assert.equal(result.selectedCandidateIndices.length, expected ? 1 : 0, `degrees ${a},${b},${c}`);
    assert.deepEqual(compileComposition(relationPlan(input, result.bindings)), compileComposition(relationPlan(input)));
    accepted += result.selectedCandidateIndices.length;
  }
  assert.equal(accepted, 6);
});

test('source-equivalent domains remain alternatives, and unsupported native pitch curves are retained literally', () => {
  const input = relationInput();
  input.material.notes = input.material.notes.slice(0, 3); input.material.span = 6;
  input.harmonies = [{ id: 'c', rootMillicents: 0, intervals: [0, 400000, 700000] }];
  input.anchorIndices = [0, 2];
  input.bindings = [
    { kind: 'harmony', harmony: 'c', tone: 0, octave: 5, residualMillicents: 0 }, literal(62),
    { kind: 'harmony', harmony: 'c', tone: 1, octave: 5, residualMillicents: 0 },
  ];
  input.domains.push({ source: 'supplied', lattice: { id: 'whole-tones', originMillicents: 0,
    periodMillicents: 1200000, intervals: [0, 200000, 400000, 600000, 800000, 1000000] } });
  const ambiguous = callCoreSync('inferPitchRelations', input);
  assert.equal(ambiguous.candidates.length, 2);
  assert.deepEqual(ambiguous.selectedCandidateIndices, []);
  assert.deepEqual(ambiguous.bindings, input.bindings);

  input.domains.pop();
  input.material.notes[1].pitchEnvelope = [{ tick: 0, pitch: { millicents: 0 } },
    { tick: 1, pitch: { millicents: 1234 } }];
  const expressive = callCoreSync('inferPitchRelations', input);
  assert.deepEqual(expressive.selectedCandidateIndices, []);
  assert.deepEqual(expressive.bindings, input.bindings);
  assert.deepEqual(compileComposition(relationPlan(input, expressive.bindings)), compileComposition(relationPlan(input)));
});

test('geometric discovery does not mistake source IDs or track layout for musical voice evidence', () => {
  const input = relationInput(), original = callCoreSync('inferPitchRelations', input);
  const changed = structuredClone(input);
  changed.material.notes.forEach((n, i) => { n.id = `renamed-${100 - i}`; n.part = i % 2 ? 'lower' : 'upper'; });
  const repartitioned = callCoreSync('inferPitchRelations', changed);
  const selected = (x: typeof original) => x.selectedCandidateIndices.map(i => {
    const c = x.candidates[i]; return [c.noteIndex, c.fromIndices, c.toIndices, c.kind, c.domainId];
  });
  assert.deepEqual(selected(repartitioned), selected(original));
  assert.ok(repartitioned.links.every(link => link.evidence === 'geometric-reciprocal-nearest'));

  const order = [4, 0, 5, 2, 1, 3], permuted = structuredClone(input);
  permuted.material.notes = order.map(i => input.material.notes[i]);
  permuted.bindings = order.map(i => input.bindings[i]);
  permuted.anchorIndices = input.anchorIndices.map(i => order.indexOf(i));
  const reordered = callCoreSync('inferPitchRelations', permuted);
  const witnesses = (x: typeof original) => x.selectedCandidateIndices
    .map(i => x.candidates[i].witnessNoteIds.join('/')).sort();
  assert.deepEqual(witnesses(reordered), witnesses(original));

  const overlapping = relationInput();
  overlapping.material.notes.push({ ...structuredClone(overlapping.material.notes[0]), id: 'equally-near-other',
    part: 'lower', onset: 0, duration: 2 });
  overlapping.bindings.push(literal(66));
  const unsupported = callCoreSync('inferPitchRelations', overlapping);
  assert.ok(unsupported.selectedCandidateIndices.every(i => unsupported.candidates[i].noteIndex !== 1),
    'Two equally near predecessors make the first stream ambiguous; the part name cannot rescue it.');
  overlapping.options = { successors: [{ from: 0, to: 1 }, { from: 1, to: 2 }, { from: 3, to: 4 }, { from: 4, to: 5 }] };
  const suppliedVoice = callCoreSync('inferPitchRelations', overlapping);
  assert.equal(suppliedVoice.selectedCandidateIndices.length, 2);
  assert.ok(suppliedVoice.links.every(link => link.evidence === 'supplied'));
});

test('an observed vocabulary supports an exact new realization without pretending to complete missing degrees', () => {
  const input = relationInput(), source = compileComposition(relationPlan(input));
  const domain = callCoreSync('observedPitchDomain', { score: source, id: 'observed',
    periodMillicents: 1200000, originMillicents: 0, maxClasses: 24 });
  assert.ok(domain);
  assert.equal(domain.source, 'observed-vocabulary');
  assert.deepEqual(domain.lattice.intervals, [0, 200000, 400000, 500000, 700000, 1100000]);
  assert.ok(!domain.lattice.intervals.includes(900000), 'An unobserved A is not filled in as a presumed scale degree.');
  input.domains = [domain];
  const analysis = callCoreSync('inferPitchRelations', input);
  assert.equal(analysis.selectedCandidateIndices.length, 2);
  const program = relationPlan(input, analysis.bindings);
  assert.deepEqual(compileComposition(program), source);
  program.harmonies![0] = { id: 'c', rootMillicents: 900000, intervals: [0, 300000, 700000] };
  assert.deepEqual(compileComposition(program).notes.map(n => n.pitch.millicents / 100000), [72, 74, 76, 71, 72, 74]);
  program.harmonies![0] = { id: 'c', rootMillicents: 100000, intervals: [0, 400000, 700000] };
  assert.throws(() => compileComposition(program), /lattice|domain/i, 'An unseen anchor pitch must not be snapped.');
  assert.throws(() => callCoreSync('observedPitchDomain', { score: source, id: 'too-small',
    periodMillicents: 1200000, originMillicents: 0, maxClasses: 2 }), /budget/i);
});

test('relation search rejects work/storage excess instead of returning an apparently complete subset', () => {
  for (const options of [{ maxLinkComparisons: 1 }, { maxCandidateChecks: 1 }, { maxCandidates: 1 }, { maxLinks: 1 }, { maxTripleChecks: 1 }, { maxCandidateMembers: 1 }]) {
    assert.throws(() => callCoreSync('inferPitchRelations', { ...relationInput(), options }), /budget/i);
  }
});

test('an unsupported intervening attack remains an observation barrier instead of disappearing from voice proposals', () => {
  const input = relationInput();
  input.material.notes.push({ id: 'intervening-curve', part: 'lower', onset: 1, duration: 1,
    pitch: { millicents: 0 }, velocity: 81, releaseVelocity: 19,
    pitchEnvelope: [{ tick: 0, pitch: { millicents: 0 } }, { tick: 1, pitch: { millicents: 25000 } }],
  });
  input.bindings.push(literal(66));
  const source = compileComposition(relationPlan(input));
  const result = callCoreSync('inferPitchRelations', input);
  assert.equal(result.work.unsupportedNotes, 1);
  assert.deepEqual(result.selectedCandidateIndices.map(i => result.candidates[i].noteIndex), [4]);
  assert.deepEqual(compileComposition(relationPlan(input, result.bindings)), source);
});

function sceneFixture(): Score {
  const score: Score = { ...fixture().context, duration: 120, trackEnds: [120, 120],
    attachments: [{ tick: 0, track: 0, order: 0, bytes: [255, 88, 4, 4, 2, 24, 8] }], notes: [] };
  for (const [cell, bass] of [48, 55].entries()) {
    const start = cell * 48;
    for (const [i, interval] of [0, 4, 7].entries()) score.notes.push({ id: `support-${cell}-${i}`, part: 'lower',
      onset: start, duration: 48, pitch: { millicents: (bass + interval) * 100000 }, velocity: 80, releaseVelocity: 40 });
    for (const [i, pitch] of (cell ? [71, 72, 74] : [64, 65, 67]).entries()) score.notes.push({ id: `upper-${cell}-${i}`, part: 'upper',
      onset: start + i * 12, duration: i === 2 ? 24 : 12, pitch: { millicents: pitch * 100000 }, velocity: 80, releaseVelocity: 31,
      gainEnvelope: [{ tick: 0, gain: .9 }, { tick: 3, gain: .4 }],
    });
  }
  // This independently observed A completes the vocabulary required by the
  // withheld F realization. Its pitch is not supplied as a scale/key label.
  score.notes.push({ id: 'independent-A', part: 'upper', onset: 108, duration: 12,
    pitch: { millicents: 6900000 }, velocity: 61, releaseVelocity: 11,
    pitchEnvelope: [{ tick: 0, pitch: { millicents: 6900000 } }, { tick: 4, pitch: { millicents: 6901250 } }],
  });
  return score;
}

test('source-only scene encoding infers both dependent notes and a domain-sensitive harmony edit beats its palette ablation', () => {
  const score = sceneFixture();
  const snapshot = structuredClone(score);
  const scene = callCoreSync('encodeScore', { score }); // No supplied domains, anchors or harmony labels.
  assert.deepEqual(callCoreSync('decodeScene', { scene: JSON.parse(JSON.stringify(scene)) }), score);
  assert.deepEqual(score, snapshot);
  assert.deepEqual(scene.pitchRelations.filter(r => r.selected).map(r => r.noteId).sort(), ['upper-0-1', 'upper-1-1']);
  assert.ok(scene.program.pitchLattices?.some(l => l.intervals.includes(900000)));
  const window = scene.harmony!.windows.find(w => w.startTick === 0)!;
  assert.notEqual(window.selected, null);
  assert.equal(window.alternatives[window.selected!].rootMillicents, 0);
  const changedScene = callCoreSync('changeSceneHarmony', { scene, windowId: window.id,
    rootMillicents: 500000, coreIntervals: [0, 400000, 700000] });
  const changed = callCoreSync('decodeScene', {scene: changedScene});
  const upperPitches = (s: Score) => [0, 1, 2].map(i => s.notes.find(n => n.id === `upper-0-${i}`)!.pitch.millicents / 100000);
  assert.deepEqual(upperPitches(changed), [69, 71, 72]);
  assert.deepEqual(changed.notes.filter(n => n.onset >= 48), score.notes.filter(n => n.onset >= 48));
  assert.deepEqual(changed.notes.map(n => [n.id, n.onset, n.duration, n.velocity, n.releaseVelocity, n.gainEnvelope]),
    score.notes.map(n => [n.id, n.onset, n.duration, n.velocity, n.releaseVelocity, n.gainEnvelope]));

  const paletteOnly = callCoreSync('encodeScore', { score,
    options: { relations: { excludedNoteIndices: score.notes.map((_, i) => i) } } });
  assert.deepEqual(paletteOnly.pitchRelations, []);
  assert.deepEqual(callCoreSync('decodeScene', { scene: paletteOnly }), score);
  const paletteWindow = paletteOnly.harmony!.windows.find(w => w.startTick === 0)!;
  const paletteEditScene = callCoreSync('changeSceneHarmony', { scene: paletteOnly, windowId: paletteWindow.id,
    rootMillicents: 500000, coreIntervals: [0, 400000, 700000] });
  const paletteEdit = callCoreSync('decodeScene', {scene: paletteEditScene});
  assert.deepEqual(upperPitches(paletteEdit), [69, 70, 72], 'A frozen chord-relative color produces B-flat instead of the anchor-dependent B.');
  for (const candidate of [scene, paletteOnly]) {
    assert.equal(candidate.costs.programJsonBytes, Buffer.byteLength(JSON.stringify(candidate.program)));
    assert.equal(candidate.costs.identityJsonBytes, Buffer.byteLength(JSON.stringify(candidate.identities)));
    assert.equal(candidate.costs.residualJsonBytes, Buffer.byteLength(JSON.stringify(candidate.velocityResiduals)));
  }
});

test('persisted selected relation metadata must agree with executable bindings and their exact owner witnesses', () => {
  const score = sceneFixture(), scene = callCoreSync('encodeScore', { score });
  assert.equal(scene.pitchRelations.filter(r => r.selected).length, 2);
  const corruptions: Array<[string, (copy: typeof scene) => void]> = [
    ['unknown member', s => { s.pitchRelations[0].noteId = 'absent-source-note'; }],
    ['known but unrelated anchor', s => { s.pitchRelations[0].fromNoteIds = ['independent-A']; }],
    ['missing endpoint witnesses', s => { s.pitchRelations[0].fromNoteIds = []; }],
    ['duplicate endpoint witness', s => { s.pitchRelations[0].fromNoteIds.push(s.pitchRelations[0].fromNoteIds[0]); }],
    ['wrong lattice', s => { s.pitchRelations[0].lattice = 'absent-domain'; }],
    ['wrong executable role', s => { s.pitchRelations[0].kind = 'upper-neighbor'; }],
    ['hidden executable relationship', s => { s.pitchRelations[0].selected = false; }],
    ['missing executable relationship', s => { s.pitchRelations = []; }],
    ['duplicate relationship identity', s => { s.pitchRelations.push(structuredClone(s.pitchRelations[0])); }],
  ];
  for (const [description, corrupt] of corruptions) {
    const copy = structuredClone(scene); corrupt(copy);
    assert.throws(() => callCoreSync('decodeScene', { scene: copy }), /relation|anchor|lattice|membership|owner/i, description);
  }
  assert.deepEqual(callCoreSync('decodeScene', { scene }), score);
});

test('source-only doubled scene keeps every emission and validates every declared value-anchor witness', () => {
  const score = sceneFixture();
  score.notes.push(...score.notes.filter(n => /^upper-0-/.test(n.id)).map(n => ({
    ...structuredClone(n), id: `double-${n.id}`, part: 'lower',
  })));
  const snapshot = structuredClone(score), scene = callCoreSync('encodeScore', { score });
  assert.deepEqual(callCoreSync('decodeScene', { scene: JSON.parse(JSON.stringify(scene)) }), score);
  assert.deepEqual(score, snapshot);
  assert.equal(scene.identities.length, score.notes.length);
  const doubled = scene.pitchRelations.filter(r => r.selected && ['upper-0-1', 'double-upper-0-1'].includes(r.noteId));
  assert.equal(doubled.length, 2);
  for (const relation of doubled) {
    assert.deepEqual([...relation.fromNoteIds].sort(), ['double-upper-0-0', 'upper-0-0']);
    assert.deepEqual([...relation.toNoteIds].sort(), ['double-upper-0-2', 'upper-0-2']);
  }
  const window = scene.harmony!.windows.find(w => w.startTick === 0)!;
  const editedScene = callCoreSync('changeSceneHarmony', { scene, windowId: window.id,
    rootMillicents: 500000, coreIntervals: [0, 400000, 700000] });
  const edited = callCoreSync('decodeScene', {scene: editedScene});
  for (const prefix of ['upper-0-', 'double-upper-0-']) {
    assert.deepEqual([0, 1, 2].map(i => edited.notes.find(n => n.id === `${prefix}${i}`)!.pitch.millicents / 100000), [69, 71, 72]);
  }
  assert.deepEqual(edited.notes.filter(n => n.onset >= 48), score.notes.filter(n => n.onset >= 48));

  // Alter only one witness's declaration, preserving its present pitch. Its
  // future palette edits are now independent, so the old shared-value evidence
  // must not silently remain valid for that witness.
  const changed = structuredClone(scene), witness = doubled[0].fromNoteIds[0];
  const emitted = changed.identities.find(i => i.id === witness)!.emittedId;
  const match = /^placement-([0-9.]+):(.+):([0-9]+)$/.exec(emitted);
  assert.ok(match);
  let placements = changed.program.placements;
  const path = match[1].split('.').map(Number);
  for (const index of path.slice(0, -1)) {
    placements = changed.program.definitions!.find(d => d.id === placements[index].material)!.placements;
  }
  const binding = placements[path[path.length - 1]].pitchBindings![Number(match[3])];
  assert.equal(binding.kind, 'harmony');
  if (binding.kind !== 'harmony') throw new Error('Expected a direct harmonic witness.');
  const palette = changed.program.harmonies!.find(h => h.id === binding.harmony)!;
  changed.program.harmonies!.push({ ...structuredClone(palette), id: 'independent-witness-only' });
  binding.harmony = 'independent-witness-only';
  assert.deepEqual(compileComposition(changed.program), compileComposition(scene.program), 'The present notes are unchanged; edit semantics differ.');
  assert.throws(() => callCoreSync('decodeScene', { scene: changed }), /relation|anchor|witness/i);
});
