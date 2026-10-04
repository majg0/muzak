import test from 'node:test';
import assert from 'node:assert/strict';
import { callCoreSync as call } from '../src/core/sync';
import type { ProgressionOptions } from '../src/core/generated/ProgressionOptions';
import type { ProgressionResult } from '../src/core/generated/ProgressionResult';
import type { Score } from '../src/core/generated/Score';

const mod12 = (pitch: number) => ((pitch % 12) + 12) % 12;
const sorted = (pitches: number[]) => [...pitches].sort((a, b) => a - b);

function options(patch: Partial<ProgressionOptions> = {}): ProgressionOptions {
  return { ...call('getProgressionDefaults', {}).options, ...patch };
}

function generate(patch: Partial<ProgressionOptions> = {}): ProgressionResult {
  return call('generateProgression', { options: options(patch) });
}

function events(score: Score) {
  return score.notes.map(note => [note.onset, note.duration, note.pitch.millicents,
    note.velocity, note.releaseVelocity]).sort((a, b) => a[0] - b[0] || a[2] - b[2]);
}

function assertRealization(result: ProgressionResult) {
  const score = call('compileComposition', { plan: result.plan });
  assert.equal(score.duration, result.steps.length * 4 * score.ppq);
  assert.equal(score.notes.length, result.steps.reduce((count, step) => count + step.voicedMidi.length, 0));
  assert.equal(new Set(score.notes.map(note => note.id)).size, score.notes.length);
  for (const step of result.steps) {
    const notes = score.notes.filter(note => note.onset >= step.index * 4 * score.ppq
      && note.onset < (step.index + 1) * 4 * score.ppq);
    assert.deepEqual(sorted(notes.map(note => note.pitch.millicents)), sorted(step.voicedMidi.map(pitch => pitch * 100000)));
    assert.deepEqual(sorted([...new Set(step.voicedMidi.map(pitch => mod12(pitch - step.chord.rootPitchClass)))]),
      sorted([...new Set(step.chord.intervals.map(mod12))]), 'Audible members must realize the chord, including its alterations.');
  }
  const scene = call('sceneFromComposition', { plan: result.plan });
  assert.equal(scene.origin, 'authored');
  assert.deepEqual(call('decodeScene', { scene: JSON.parse(JSON.stringify(scene)) }), score,
    'The authored scene decodes without the generator, catalog or prior analysis.');
  const imported = call('importMidi', { bytes: call('exportScoreMidi', { score }) }).score;
  assert.deepEqual(events(imported), events(score));
  return score;
}

test('seeded progression generation varies symbolic routes and preserves its premises', () => {
  const input = options({ tonic: 'C', family: 'major', mode: 0, color: 'chromatic', length: 8, seed: 29 });
  const saved = structuredClone(input);
  const first = call('generateProgression', { options: input });
  assert.deepEqual(call('generateProgression', { options: input }), first);
  assert.deepEqual(input, saved);
  assert.deepEqual(first.options, saved);
  const routes = new Set(Array.from({ length: 8 }, (_, seed) =>
    generate({ ...input, seed }).steps.map(step => step.chordId).join('|')));
  assert.ok(routes.size >= 3, 'Changing the seed must produce several actual harmonic routes, not only metadata changes.');
});

test('progressions use the existing compiler, authored scenes and lossless MIDI with both articulations', () => {
  for (const arpeggiate of [false, true]) {
    const result = generate({ tonic: 'C', family: 'harmonicMinor', mode: 0, color: 'adventurous', seed: 13, arpeggiate });
    const score = assertRealization(result);
    const firstAttacks = new Set(score.notes.filter(note => note.onset < 4 * score.ppq).map(note => note.onset));
    assert.equal(firstAttacks.size, arpeggiate ? result.steps[0].voicedMidi.length : 1);
  }
});

test('harmonic and melodic collections rotate their actual pitch content in every mode', () => {
  // Independent collection definitions, not copies of labels returned by the generator.
  const families = {
    major: [0, 2, 4, 5, 7, 9, 11],
    harmonicMinor: [0, 2, 3, 5, 7, 8, 11],
    melodicMinor: [0, 2, 3, 5, 7, 9, 11],
    harmonicMajor: [0, 2, 4, 5, 7, 8, 11],
  } as const;
  for (const [family, parent] of Object.entries(families)) {
    for (let mode = 0; mode < 7; mode++) {
      const result = generate({ tonic: 'C', family: family as ProgressionOptions['family'], mode, color: 'diatonic', length: 4 });
      const expected = Array.from({ length: 7 }, (_, index) => mod12(parent[(mode + index) % 7] - parent[mode]));
      assert.deepEqual(result.catalog.scaleOffsets, expected, `${family}, mode ${mode}`);
      assert.equal(result.catalog.scaleTones.length, 7);
      for (const chord of result.catalog.chords.filter(chord => chord.colorCost === 0)) {
        assert.ok(chord.intervals.every(interval => expected.includes(mod12(chord.rootPitchClass + interval))),
          `${family}, mode ${mode}: ${chord.name} claims to be native to the collection.`);
      }
      assert.ok(result.steps.every(step => step.chord.colorCost === 0), 'Diatonic-only generation cannot introduce a chromatic operation.');
    }
  }
});

test('Roman numerals show diminished, half-diminished, augmented and raised-leading-tone harmony', () => {
  const find = (result: ProgressionResult, degree: number, intervals: number[]) => {
    const chord = result.catalog.chords.find(chord => chord.colorCost === 0 && chord.degree === degree
      && JSON.stringify(chord.intervals) === JSON.stringify(intervals));
    assert.ok(chord, `Missing native degree ${degree + 1}, intervals ${intervals}.`);
    return chord;
  };
  const major = generate({ tonic: 'C', family: 'major', mode: 0, color: 'diatonic' });
  assert.equal(find(major, 0, [0, 4, 7]).roman, 'I');
  assert.equal(find(major, 1, [0, 3, 7]).roman, 'ii');
  assert.match(find(major, 6, [0, 3, 6]).roman, /^vii[°o]$/);
  assert.match(find(major, 6, [0, 3, 6, 10]).roman, /^vii[øØ]/);
  const harmonic = generate({ tonic: 'C', family: 'harmonicMinor', mode: 0, color: 'diatonic' });
  assert.equal(find(harmonic, 0, [0, 3, 7]).roman, 'i');
  assert.match(find(harmonic, 1, [0, 3, 6]).roman, /^ii[°o]$/);
  assert.match(find(harmonic, 2, [0, 4, 8]).roman, /III\+/);
  assert.equal(find(harmonic, 4, [0, 4, 7]).roman, 'V');
  assert.match(find(harmonic, 6, [0, 3, 6, 9]).roman, /^vii[°o]7$/);
  const melodic = generate({ tonic: 'C', family: 'melodicMinor', mode: 0, color: 'diatonic' });
  assert.equal(find(melodic, 3, [0, 4, 7]).roman, 'IV');
  assert.match(find(melodic, 5, [0, 3, 6]).roman, /^vi[°o]$/);
  assert.ok(major.steps.every(step => step.chord.roman.length > 0 && step.reason.length > 0));
  assert.equal(major.steps.at(-1)!.chord.roman, 'I');
});

test('transposing the tonic preserves degrees and Roman readings while changing actual roots and notes', () => {
  const c = generate({ tonic: 'C', family: 'major', mode: 0, color: 'chromatic', seed: 37 });
  const d = generate({ ...c.options, tonic: 'D' });
  assert.deepEqual(d.catalog.scaleOffsets, c.catalog.scaleOffsets);
  assert.notDeepEqual(d.catalog.scaleTones, c.catalog.scaleTones);
  assert.deepEqual(d.steps.map(step => [step.chord.degree, step.chord.roman, step.chord.globalRoman, step.chord.operator]),
    c.steps.map(step => [step.chord.degree, step.chord.roman, step.chord.globalRoman, step.chord.operator]));
  for (let index = 0; index < c.steps.length; index++) {
    const before = c.steps[index], after = d.steps[index];
    assert.equal(mod12(after.chord.rootPitchClass - before.chord.rootPitchClass), 2);
    assert.deepEqual(sorted([...new Set(after.voicedMidi.map(mod12))]),
      sorted([...new Set(before.voicedMidi.map(pitch => mod12(pitch + 2)))]));
  }
});

test('applied, diminished, substitute and altered operations emit their declared chromatic notes and resolve', () => {
  const premise = generate({ tonic: 'C', family: 'major', mode: 0, color: 'adventurous', length: 4 });
  const cases = [
    { id: 'dominant-4', roman: 'V7/V', operator: 'appliedDominant', root: 2, target: 4, intervals: [0, 4, 7, 10] },
    { id: 'leading-4', roman: 'vii°7/V', operator: 'leadingDiminished', root: 6, target: 4, intervals: [0, 3, 6, 9] },
    { id: 'substitute-0', roman: 'subV7', operator: 'tritoneSubstitution', root: 1, target: 0, intervals: [0, 4, 7, 10] },
    { id: 'altered-0-flat9', roman: 'V7(♭9)', operator: 'alteredDominant', root: 7, target: 0, intervals: [0, 4, 7, 10, 13] },
    { id: 'altered-0-sharp9', roman: 'V7(♯9)', operator: 'alteredDominant', root: 7, target: 0, intervals: [0, 4, 7, 10, 15] },
    { id: 'altered-0-flat5', roman: 'V7(♭5)', operator: 'alteredDominant', root: 7, target: 0, intervals: [0, 4, 6, 10] },
    { id: 'altered-0-sharp5', roman: 'V7(♯5)', operator: 'alteredDominant', root: 7, target: 0, intervals: [0, 4, 8, 10] },
  ];
  for (const expected of cases) {
    const chord = premise.catalog.chords.find(chord => chord.id === expected.id);
    assert.ok(chord);
    assert.equal(chord.roman, expected.roman);
    assert.equal(chord.operator, expected.operator);
    assert.equal(chord.rootPitchClass, expected.root);
    assert.equal(chord.resolutionDegree, expected.target);
    assert.deepEqual(chord.intervals, expected.intervals);
    const passage = call('generateProgression', { options: premise.options,
      chordIds: ['scale-0-3', chord.id, `scale-${expected.target}-3`, 'scale-0-3'] });
    assertRealization(passage);
  }
  assert.deepEqual(premise.catalog.chords.find(chord => chord.id === 'substitute-0')!.toneNames, ['D♭', 'F', 'A♭', 'C♭']);
  assert.deepEqual(premise.catalog.chords.find(chord => chord.id === 'leading-4')!.toneNames, ['F♯', 'A', 'C', 'E♭']);
  assert.throws(() => call('generateProgression', { options: premise.options,
    chordIds: ['scale-0-3', 'dominant-4', 'scale-3-3', 'scale-0-3'] }), /target|directed|follow/i,
    'D7 cannot retain its declared G target while the edited next chord is F.');
});

test('borrowed minor iv changes real collection membership and remains distinct from native IV', () => {
  const result = generate({ tonic: 'C', family: 'major', mode: 0, color: 'chromatic', length: 4 });
  const native = result.catalog.chords.find(chord => chord.degree === 3 && chord.colorCost === 0 && chord.intervals.length === 3)!;
  const borrowed = result.catalog.chords.find(chord => chord.degree === 3 && chord.operator === 'borrowed'
    && JSON.stringify(chord.intervals) === JSON.stringify([0, 3, 7]));
  assert.ok(borrowed);
  assert.equal(native.roman, 'IV');
  assert.equal(borrowed.roman, 'iv');
  assert.deepEqual(borrowed.toneNames, ['F', 'A♭', 'C']);
  assert.ok(borrowed.colorCost > 0);
  assert.equal(borrowed.resolutionDegree, null);
  assert.ok(borrowed.intervals.some(interval => !result.catalog.scaleOffsets.includes(mod12(borrowed.rootPitchClass + interval))));
  const changed = call('generateProgression', { options: result.options,
    chordIds: ['scale-0-3', borrowed.id, 'scale-4-3', 'scale-0-3'] });
  assertRealization(changed);
  const diatonic = generate({ ...result.options, color: 'diatonic' });
  assert.ok(diatonic.steps.every(step => step.chord.colorCost === 0
    && step.replacements.every(replacement => diatonic.catalog.chords.find(chord => chord.id === replacement.chordId)!.colorCost === 0)));
  assert.throws(() => call('generateProgression', { options: diatonic.options,
    chordIds: changed.steps.map(step => step.chordId) }), /unknown|color|chord/i);
});

test('every generated directed chord is followed by its declared native target', () => {
  let directedCount = 0;
  for (let seed = 0; seed < 12; seed++) {
    const result = generate({ tonic: 'C', family: 'major', mode: 0, color: 'adventurous', length: 12, seed });
    for (const [index, step] of result.steps.entries()) {
      if (step.chord.resolutionDegree === null) continue;
      const target = result.steps[index + 1];
      assert.ok(target, `${step.chord.name} requires a destination after its own slot.`);
      assert.equal(target.chord.degree, step.chord.resolutionDegree);
      assert.equal(target.chord.colorCost, 0, 'The proposed resolution must actually arrive at the native target.');
      assert.equal(target.chord.rootPitchClass, step.chord.resolutionRootPitchClass,
        'A matching degree number cannot replace the declared sounding target root.');
      const requiredCore = result.catalog.chords.find(chord => chord.id === step.chord.resolutionChordId);
      assert.ok(requiredCore);
      assert.ok(requiredCore.intervals.every(interval => target.chord.intervals.includes(interval)),
        'The receiving chord must contain the promised native core, not only a matching root label.');
      directedCount++;
    }
  }
  assert.ok(directedCount > 0, 'The chromatic control must exercise real applied harmony.');
});

test('bounded generated passages begin and return home without collapsing into one repeated chord', () => {
  for (const length of [4, 5, 8, 12, 16]) {
    const result = generate({ tonic: 'C', family: 'major', mode: 0, length, color: 'diatonic', seed: 41 });
    assert.equal(result.steps.length, length);
    for (const step of [result.steps[0], result.steps.at(-1)!]) {
      assert.equal(step.chord.degree, 0);
      assert.equal(step.chord.rootAlteration, 0);
      assert.equal(step.chord.colorCost, 0);
    }
    assert.ok(new Set(result.steps.map(step => step.chord.rootPitchClass)).size > 1);
    assert.ok(result.steps.every(step => step.voicedMidi.every(pitch => Number.isInteger(pitch) && pitch >= 36 && pitch <= 84)));
    for (let index = 1; index < result.steps.length; index++) {
      assert.ok(Math.abs(Math.min(...result.steps[index].voicedMidi) - Math.min(...result.steps[index - 1].voicedMidi)) <= 12,
        'Default bass realization should not jump more than an octave between adjacent chords.');
    }
  }
});

test('an offered replacement edits one harmonic slot while the compiler recomputes the voiced passage', () => {
  const original = generate({ tonic: 'C', family: 'major', mode: 0, color: 'adventurous', length: 8, seed: 31 });
  const saved = structuredClone(original);
  for (const step of original.steps) {
    const costs = step.replacements.map(replacement => replacement.cost);
    assert.ok(costs.every(cost => Number.isFinite(cost) && cost >= 0));
    assert.deepEqual(costs, sorted(costs),
      'Replacement suggestions must rank by the disclosed connection cost for both neighbors.');
  }
  const content = (chordId: string) => {
    const chord = original.catalog.chords.find(chord => chord.id === chordId)!;
    return JSON.stringify(sorted(chord.intervals.map(interval => mod12(chord.rootPitchClass + interval))));
  };
  const index = original.steps.findIndex((step, index) => index > 0 && index < original.steps.length - 1
    && step.replacements.some(replacement => content(replacement.chordId) !== content(step.chordId)));
  assert.ok(index > 0, 'A generated passage must expose at least one meaningful local harmonic choice.');
  const replacement = original.steps[index].replacements.find(item => content(item.chordId) !== content(original.steps[index].chordId))!;
  const chordIds = original.steps.map(step => step.chordId);
  chordIds[index] = replacement.chordId;
  const edited = call('generateProgression', { options: original.options, chordIds });
  assert.deepEqual(edited.steps.map(step => step.chordId), chordIds,
    'The accepted edit retains every other symbolic choice; it does not secretly regenerate the route.');
  assert.deepEqual(original, saved);
  assertRealization(edited);
  assert.notDeepEqual(edited.steps[index].voicedMidi.map(mod12), original.steps[index].voicedMidi.map(mod12));
});

test('invalid premises and malformed edits fail rather than silently clamping or changing the request', () => {
  const invalid: Partial<ProgressionOptions>[] = [
    { tonic: 'H' }, { family: 'unknown' as ProgressionOptions['family'] },
    { mode: -1 }, { mode: 7 }, { mode: 0.5 }, { length: 3 }, { length: 17 }, { length: 4.5 },
    { color: 'unknown' as ProgressionOptions['color'] }, { seed: -1 }, { seed: 4294967296 },
    { tempo: 29 }, { tempo: 241 }, { lineContinuity: -1 }, { lineContinuity: 101 },
  ];
  for (const patch of invalid) {
    assert.throws(() => generate(patch), /invalid|unknown|expected|range|mode|length|tempo|seed|tonic|variant|continuity/i,
      `Invalid premise was accepted: ${JSON.stringify(patch)}`);
  }
  const result = generate();
  assert.throws(() => call('generateProgression', { options: result.options, chordIds: ['missing'] }), /invalid|unknown|length|chord/i);
  const ids = result.steps.map(step => step.chordId);
  ids[1] = 'missing';
  assert.throws(() => call('generateProgression', { options: result.options, chordIds: ids }), /invalid|unknown|chord/i);
  const nonHome = result.steps.map(step => step.chordId);
  nonHome[0] = 'scale-1-3';
  assert.throws(() => call('generateProgression', { options: result.options, chordIds: nonHome }), /center|tonic|home|begin/i);
});
