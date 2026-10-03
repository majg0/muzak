import test from 'node:test';
import assert from 'node:assert/strict';
import { callCoreSync } from '../src/core/sync';

test('both lab bridges produce programs through the shared compiler and MIDI exporter', () => {
  const defaults = callCoreSync('getLabDefaults', {});
  const saved = structuredClone(defaults);
  const melody = callCoreSync('generateMelodyLab', { options: defaults.melody });
  const rhythm = callCoreSync('generateRhythmLab', { options: defaults.rhythm });
  for (const [plan, expected] of [[melody, defaults.melody.notes * defaults.melody.repeats], [rhythm, defaults.rhythm.pulses * defaults.rhythm.repeats]] as const) {
    const score = callCoreSync('compileComposition', { plan });
    assert.equal(score.notes.length, expected);
    assert.equal(plan.materials.length, 1, 'Repetition reuses one authored material.');
    assert.equal(new Set(score.notes.map(note => note.id)).size, expected);
    const meter = callCoreSync('scoreMeter', { score });
    assert.equal(meter.toTick, score.duration);
    const bytes = callCoreSync('exportScoreMidi', { score });
    const imported = callCoreSync('importMidi', { bytes }).score;
    assert.deepEqual(imported.notes.map(note => [note.pitch.millicents, note.onset, note.duration]), score.notes.map(note => [note.pitch.millicents, note.onset, note.duration]));
  }
  assert.deepEqual(defaults, saved, 'Generating either study does not mutate shared defaults.');
});

test('lab silence retains its exact duration and is exportable', () => {
  const plan = callCoreSync('generateRhythmLab', { options: { pulses: 0, steps: 7, repeats: 3, step: { numerator: 2, denominator: 7 } } });
  const score = callCoreSync('compileComposition', { plan });
  assert.equal(score.notes.length, 0);
  assert.equal(score.duration / score.ppq, 6);
  const bytes = callCoreSync('exportScoreMidi', { score });
  const imported = callCoreSync('importMidi', { bytes }).score;
  assert.equal(imported.duration, score.duration);
});

test('a native pitch edit survives lab generation and keeps strict MIDI export', () => {
  const options = callCoreSync('getLabDefaults', {}).melody;
  options.lattice.originMillicents += 1;
  const plan = callCoreSync('generateMelodyLab', { options });
  const score = callCoreSync('compileComposition', { plan });
  assert.ok(score.notes.every(note => note.pitch.millicents % 100000 === 1));
  assert.throws(() => callCoreSync('exportScoreMidi', { score }), /pitch|MIDI|millicent/i);
});
