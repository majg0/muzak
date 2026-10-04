import test from 'node:test';
import assert from 'node:assert/strict';
import { callCoreSync } from '../src/core/sync';
import type { ValueTree } from '../src/core/generated/ValueTree';
import type { ValueTreeProgram } from '../src/core/generated/ValueTreeProgram';

function sequence<T>(values: T[]): ValueTree<T> {
  return { kind: 'sequence', items: values.map(value => ({ kind: 'leaf', value })) };
}

function valueProgram<T>(id: string, values: T[]): ValueTreeProgram<T> {
  return { definitions: { [id]: sequence(values) }, tree: { kind: 'ref', id } };
}

test('pattern examples retain executable structure across the Rust/Wasm boundary', () => {
  const defaults = callCoreSync('getPatternLabDefaults', {});
  assert.equal(defaults.examples.length, 6);
  for (const example of defaults.examples) {
    const plan = JSON.parse(JSON.stringify(example.plan));
    assert.ok(plan.patterns.voices.length);
    assert.equal(plan.materials.length, 0);
    const score = callCoreSync('compileComposition', { plan });
    assert.ok(score.notes.length > 0);
    const scene = callCoreSync('sceneFromComposition', { plan });
    assert.deepEqual(scene.program.patterns, plan.patterns);
    assert.deepEqual(callCoreSync('decodeScene', { scene }), score);
  }
});

test('editing shared B regenerates every occurrence with unchanged rhythm', () => {
  const defaults = callCoreSync('getPatternLabDefaults', {});
  defaults.options.durations = valueProgram('R', [{ numerator: 1, denominator: 2 }]);
  const plan = callCoreSync('generatePatternLab', { options: defaults.options });
  const before = callCoreSync('compileComposition', { plan });
  const original = [60,64,62,62,65,64,64,67,65];
  assert.deepEqual(before.notes.map(note => note.pitch.millicents / 100000), [...original, ...original]);
  assert.equal(before.ppq, 4);
  assert.equal(before.duration, 18);
  assert.deepEqual(before.notes.map(note => [note.onset, note.duration]), Array.from({ length: 18 }, (_, onset) => [onset, 1]));
  const line = plan.patterns!.numberDefinitions.line;
  assert.equal(line.kind, 'values');
  if (line.kind !== 'values') throw new Error('Expected an untimed degree tree.');
  const b = line.source.definitions.B;
  assert.equal(b.kind, 'sequence');
  if (b.kind !== 'sequence') throw new Error('Expected shared B sequence.');
  b.items = [0,1,2].map(value => ({ kind: 'leaf', value }));
  const after = callCoreSync('compileComposition', { plan });
  const edited = [60,62,64,62,64,65,64,65,67];
  assert.deepEqual(after.notes.map(note => note.pitch.millicents / 100000), [...edited, ...edited]);
  assert.deepEqual(after.notes.map(note => [note.onset, note.duration]), before.notes.map(note => [note.onset, note.duration]));

  // Changing the child's leaf count must change the nesting itself. There is
  // no old outer duration to retain, and the duration tree stays untouched.
  b.items = [0,2].map(value => ({ kind: 'leaf', value }));
  const shorter = callCoreSync('compileComposition', { plan });
  const shorterPhrase = [60,64,62,65,64,67,60,64,62];
  assert.deepEqual(shorter.notes.map(note => note.pitch.millicents / 100000), [...shorterPhrase, ...shorterPhrase]);
  assert.deepEqual(shorter.notes.map(note => [note.onset, note.duration]), before.notes.map(note => [note.onset, note.duration]));
});

test('fractional duration leaves advance degrees without imposing a pitch-derived time window', () => {
  const { options } = callCoreSync('getPatternLabDefaults', {});
  options.durations = valueProgram('R', [{ numerator: 2, denominator: 3 }]);
  const score = callCoreSync('compileComposition', { plan: callCoreSync('generatePatternLab', { options }) });
  const phrase = [60,64,62,62,65,64,64,67,65];
  assert.deepEqual(score.notes.map(note => note.pitch.millicents / 100000), [...phrase, ...phrase]);
  assert.equal(score.ppq, 6);
  assert.equal(score.duration, 36);
  const firstTiming = Array.from({ length: 9 }, (_, index) => [2 * index, 2]);
  assert.deepEqual(score.notes.map(note => [note.onset, note.duration]), [
    ...firstTiming,
    ...firstTiming.map(([onset, duration]) => [18 + onset, duration]),
  ]);
});

test('long cells advance degree and native offsets once while masks leave their assignments intact', () => {
  const { options } = callCoreSync('getPatternLabDefaults', {});
  options.durations = valueProgram('R', [{ numerator: 2, denominator: 1 }, { numerator: 1, denominator: 1 }]);
  options.chromaticMillicents = valueProgram('offset', [0, 25000, -50000, 100000]);
  const all = callCoreSync('compileComposition', { plan: callCoreSync('generatePatternLab', { options }) });
  assert.deepEqual(all.notes.slice(0, 4).map(note => [note.onset, note.duration]), [[0,2],[2,1],[3,2],[5,1]]);
  const phrase = [6000000, 6425000, 6150000, 6300000, 6500000, 6425000, 6350000, 6800000, 6500000];
  assert.deepEqual(all.notes.map(note => note.pitch.millicents), [...phrase, ...phrase]);
  assert.equal(all.duration, 28);
  assert.deepEqual(all.notes.slice(8, 11).map(note => [note.onset, note.duration]), [[12,2],[14,2],[16,1]]);
  options.gates = valueProgram('sound', [false, true]);
  const masked = callCoreSync('compileComposition', { plan: callCoreSync('generatePatternLab', { options }) });
  assert.deepEqual(masked.notes.slice(0, 3).map(note => [note.onset, note.duration]), [[2,1],[5,1],[8,1]]);
  assert.deepEqual(
    masked.notes.map(note => [note.onset, note.duration, note.pitch.millicents]),
    all.notes.filter((_, index) => (index % options.steps) % 2 === 1).map(note => [note.onset, note.duration, note.pitch.millicents]),
  );
  assert.equal(masked.duration, all.duration);
});

test('degree-tree size and duration-tree values edit independently with an explicit cell limit', () => {
  const { options } = callCoreSync('getPatternLabDefaults', {});
  const original = callCoreSync('generatePatternLab', { options });
  const originalScore = callCoreSync('compileComposition', { plan: original });
  options.degrees.definitions.A = sequence([0,1,2,3]);
  options.degrees.definitions.B = sequence([0,2]);
  const changedDegrees = callCoreSync('generatePatternLab', { options });
  const changedScore = callCoreSync('compileComposition', { plan: changedDegrees });
  assert.deepEqual(changedDegrees.patterns!.voices[0].rhythm, original.patterns!.voices[0].rhythm);
  assert.deepEqual(changedScore.notes.map(note => [note.onset, note.duration]), originalScore.notes.map(note => [note.onset, note.duration]));
  assert.equal(changedScore.duration, originalScore.duration);

  options.durations = valueProgram('R', [{ numerator: 2, denominator: 3 }]);
  const changedDurations = callCoreSync('generatePatternLab', { options });
  assert.deepEqual(changedDurations.patterns!.numberDefinitions, changedDegrees.patterns!.numberDefinitions);
  const retimedScore = callCoreSync('compileComposition', { plan: changedDurations });
  assert.deepEqual(retimedScore.notes.map(note => note.pitch), changedScore.notes.map(note => note.pitch));
  assert.equal(retimedScore.notes.length, options.steps * options.repeats);
  const degreeTree = changedDurations.patterns!.numberDefinitions.line;
  assert.equal(degreeTree.kind, 'values');
  if (degreeTree.kind !== 'values') throw new Error('Expected an untimed degree tree.');
  assert.ok(!JSON.stringify(degreeTree.source).includes('"span"'));

  options.steps = 12;
  const longerScore = callCoreSync('compileComposition', { plan: callCoreSync('generatePatternLab', { options }) });
  assert.equal(longerScore.notes.length, 24);
  assert.equal(longerScore.duration, 48);
  assert.deepEqual(longerScore.notes.slice(0, 12).map(note => note.pitch), longerScore.notes.slice(12).map(note => note.pitch));
});

test('recursive editor programs retain nested references and independent duration trees across scene saving', () => {
  const { options } = callCoreSync('getPatternLabDefaults', {});
  options.degrees = valueProgram('seed', [0,1]);
  for (let level = 0; level < 3; level++) {
    options.degrees.tree = {
      kind: 'expand', parent: sequence([0,1]),
      children: [options.degrees.tree], operation: 'add',
    };
  }
  options.durations = {
    definitions: {},
    tree: {
      kind: 'sequence', items: [
        { kind: 'leaf', value: { numerator: 1, denominator: 2 } },
        { kind: 'repeat', count: 2, tree: sequence([{ numerator: 1, denominator: 1 }]) },
      ],
    },
  };
  options.steps = 16;
  const plan = callCoreSync('generatePatternLab', { options });
  const scene = JSON.parse(JSON.stringify(callCoreSync('sceneFromComposition', { plan })));
  const before = callCoreSync('decodeScene', { scene });
  assert.equal(before.notes.length, 32);
  assert.equal(before.ppq, 4);
  assert.equal(before.duration, 52);
  assert.deepEqual(before.notes.slice(0, 8).map(note => note.pitch.millicents / 100000), [60,62,62,64,62,64,64,65]);
  scene.program.patterns.numberDefinitions.line.source.definitions.seed = sequence([0,2]);
  const after = callCoreSync('decodeScene', { scene });
  assert.deepEqual(after.notes.slice(0, 8).map(note => note.pitch.millicents / 100000), [60,64,62,65,62,65,64,67]);
  assert.deepEqual(after.notes.map(note => [note.onset, note.duration]), before.notes.map(note => [note.onset, note.duration]));
  assert.equal(after.notes[17].pitch.millicents, 6400000);
});

test('a saved duration tree can be edited without rewriting degree structure or detaching scene edits', () => {
  const { options } = callCoreSync('getPatternLabDefaults', {});
  const plan = callCoreSync('generatePatternLab', { options });
  const degreeDefinitions = JSON.parse(JSON.stringify(plan.patterns!.numberDefinitions));
  const before = callCoreSync('compileComposition', { plan });
  const rhythm = plan.patterns!.voices[0].rhythm;
  assert.equal(rhythm.kind, 'durations');
  if (rhythm.kind !== 'durations') throw new Error('Expected an independent duration tree.');
  rhythm.source.definitions.R = {
    kind: 'sequence',
    items: [
      { kind: 'leaf', value: { numerator: 1, denominator: 2 } },
      { kind: 'leaf', value: { numerator: 3, denominator: 2 } },
    ],
  };
  const scene = JSON.parse(JSON.stringify(callCoreSync('sceneFromComposition', { plan })));
  const edited = callCoreSync('decodeScene', { scene });
  assert.deepEqual(edited.notes.map(note => note.pitch), before.notes.map(note => note.pitch));
  assert.equal(edited.ppq, 4);
  assert.equal(edited.duration, 34);
  assert.deepEqual(edited.notes.slice(0, 5).map(note => [note.onset, note.duration]), [[0,1],[1,3],[4,1],[5,3],[8,1]]);
  assert.deepEqual(scene.program.patterns.numberDefinitions, degreeDefinitions);
  const shifted = callCoreSync('transposeScene', { scene, scope: 'occurrence', target: '0', millicents: 25000 });
  const shiftedScore = callCoreSync('decodeScene', { scene: shifted });
  assert.deepEqual(shifted.program.patterns!.numberDefinitions, degreeDefinitions);
  assert.deepEqual(shiftedScore.notes.map(note => [note.onset, note.duration]), edited.notes.map(note => [note.onset, note.duration]));
  assert.deepEqual(shiftedScore.notes.map(note => note.pitch.millicents), edited.notes.map(note => note.pitch.millicents + 25000));
});

test('7/3 cycles clip at an exact 16-unit window and restart', () => {
  const { examples } = callCoreSync('getPatternLabDefaults', {});
  const plan = examples.find(example => example.id === 'window')!.plan;
  const score = callCoreSync('compileComposition', { plan });
  assert.equal(score.ppq, 6);
  assert.equal(score.duration, 96);
  assert.equal(score.notes.length, 28);
  assert.deepEqual(score.notes.slice(13, 15).map(note => [note.onset, note.duration]), [[45,3],[48,3]]);
  assert.throws(() => callCoreSync('exportScoreMidi', { score }), /pitch|MIDI|represent/i);
});
