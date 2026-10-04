import test from 'node:test';
import assert from 'node:assert/strict';
import { callCoreSync } from '../src/core/sync';

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
  defaults.options.durations = [{ numerator: 1, denominator: 2 }];
  const plan = callCoreSync('generatePatternLab', { options: defaults.options });
  const before = callCoreSync('compileComposition', { plan });
  const original = [60,64,62,62,65,64,64,67,65];
  assert.deepEqual(before.notes.map(note => note.pitch.millicents / 100000), [...original, ...original, ...original, ...original]);
  assert.equal(before.ppq, 4);
  assert.equal(before.duration, 36);
  assert.deepEqual(before.notes.map(note => [note.onset, note.duration]), Array.from({ length: 36 }, (_, onset) => [onset, 1]));
  const b = plan.patterns!.numberDefinitions.B;
  assert.equal(b.kind, 'sequence');
  if (b.kind !== 'sequence') throw new Error('Expected shared B sequence.');
  b.items = [0,1,2].map(value => ({ kind: 'atom', value, span: { numerator: 1, denominator: 1 } }));
  const after = callCoreSync('compileComposition', { plan });
  const edited = [60,62,64,62,64,65,64,65,67];
  assert.deepEqual(after.notes.map(note => note.pitch.millicents / 100000), [...edited, ...edited, ...edited, ...edited]);
  assert.deepEqual(after.notes.map(note => [note.onset, note.duration]), before.notes.map(note => [note.onset, note.duration]));
});

test('fractional duration cells advance degrees and clip exactly before the phrase restarts', () => {
  const { options } = callCoreSync('getPatternLabDefaults', {});
  options.durations = [{ numerator: 2, denominator: 3 }];
  const score = callCoreSync('compileComposition', { plan: callCoreSync('generatePatternLab', { options }) });
  const phrase = [60,64,62,62,65,64,64,67,65,60,64,62,62,65];
  assert.deepEqual(score.notes.map(note => note.pitch.millicents / 100000), [...phrase, ...phrase]);
  assert.equal(score.ppq, 6);
  assert.equal(score.duration, 54);
  const firstTiming = Array.from({ length: 14 }, (_, index) => [2 * index, index === 13 ? 1 : 2]);
  assert.deepEqual(score.notes.map(note => [note.onset, note.duration]), [
    ...firstTiming,
    ...firstTiming.map(([onset, duration]) => [27 + onset, duration]),
  ]);
});

test('long cells advance degree and native offsets once while masks leave their assignments intact', () => {
  const { options } = callCoreSync('getPatternLabDefaults', {});
  options.durations = [{ numerator: 2, denominator: 1 }, { numerator: 1, denominator: 1 }];
  options.chromaticMillicents = [0, 25000, -50000, 100000];
  const all = callCoreSync('compileComposition', { plan: callCoreSync('generatePatternLab', { options }) });
  assert.deepEqual(all.notes.slice(0, 4).map(note => [note.onset, note.duration]), [[0,2],[2,1],[3,2],[5,1]]);
  const phrase = [6000000, 6425000, 6150000, 6300000, 6500000, 6425000];
  assert.deepEqual(all.notes.map(note => note.pitch.millicents), [...phrase, ...phrase]);
  options.gates = [false, true];
  const masked = callCoreSync('compileComposition', { plan: callCoreSync('generatePatternLab', { options }) });
  assert.deepEqual(masked.notes.slice(0, 3).map(note => [note.onset, note.duration]), [[2,1],[5,1],[8,1]]);
  assert.deepEqual(
    masked.notes.map(note => [note.onset, note.duration, note.pitch.millicents]),
    all.notes.filter((_, index) => index % 2 === 1).map(note => [note.onset, note.duration, note.pitch.millicents]),
  );
  assert.equal(masked.duration, all.duration);
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
