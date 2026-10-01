import test from 'node:test';
import assert from 'node:assert/strict';
import { MusicEngine, eventHash } from '../src/engine';
import { TUNINGS, degreeToPitch, pitchToDegree, pitchToHz, type TuningId } from '../src/pitch';
import { createPerformance, parsePerformance, serializePerformance } from '../src/serialization';
import { MANUAL_CONDUCTOR } from '../src/conductor';
import { nativeSpace, validNativeVoices } from '../src/engine/native-space';
import { projectSonority } from '../src/engine/tuning-transition';
import { exportMidi } from '../src/midi';
import { harmonicPitchClasses, transformTriad } from '../src/engine/harmonic-tools';

function generate(tuning: TuningId, seed = 'native-capability') {
  const recipe = createPerformance(seed);
  recipe.sound.tuning = tuning;
  recipe.conductor = { ...MANUAL_CONDUCTOR };
  recipe.initialParameters.ideaDensity = .72;
  const copy = parsePerformance(serializePerformance(recipe));
  const engine = new MusicEngine({ ...copy, parameters: copy.initialParameters });
  return { recipe: copy, frames: Array.from({ length: 40 }, () => engine.step()) };
}

test('each native space composes and serializes without silently rounding ensemble notes', () => {
  for (const tuning of ['19edo', '24edo', '31edo'] as const) {
    const { recipe, frames } = generate(tuning), repeat = generate(tuning).frames;
    assert.deepEqual(frames, repeat);
    assert.deepEqual(parsePerformance(serializePerformance(recipe)), recipe);
    let fractional = 0;
    for (const frame of frames) {
      const upper = frame.voicePitches.map(pitch => pitchToDegree(tuning, pitch));
      assert.ok(validNativeVoices(upper, tuning));
      const bass = pitchToDegree(tuning, frame.bassPitch), space = nativeSpace(tuning);
      assert.ok(bass >= space.bass[0] && bass <= space.bass[1]);
      assert.ok(upper[0] - bass >= space.bassGap);
      for (const note of frame.notes.filter(note => note.part !== 'percussion')) {
        const pitch = note.endPitch ?? note.absolutePitch!;
        assert.deepEqual(pitch, degreeToPitch(tuning, pitchToDegree(tuning, pitch)), `${tuning} ${note.id}`);
        assert.equal(note.midiNote, undefined);
        assert.ok(pitchToHz(pitch) > 15 && pitchToHz(pitch) < 10000);
        fractional += Number(pitch.millicents % 100000 !== 0);
      }
    }
    assert.ok(fractional > 20, `${tuning} must actually use its additional locations`);
    assert.throws(() => exportMidi(frames, 0, 3840), /12-TET only/);
  }
});

test('native continuation search differs from retuning the baseline after composition', () => {
  const baseline = generate('12tet').frames;
  for (const tuning of ['19edo', '24edo', '31edo'] as const) {
    const native = generate(tuning).frames;
    const retuned = baseline.map(frame => frame.voicePitches.map(pitch => degreeToPitch(tuning, pitchToDegree(tuning, pitch))));
    assert.notDeepEqual(native.map(frame => frame.voicePitches), retuned);
    assert.notEqual(eventHash(native.flatMap(frame => frame.notes)), eventHash(baseline.flatMap(frame => frame.notes)));
  }
});

test('tuning transfers keep physical ranges and ordering across every supported pair', () => {
  for (const source of Object.keys(TUNINGS) as TuningId[]) for (const target of ['19edo', '24edo', '31edo'] as const) {
    for (const frame of generate(source).frames.slice(0, 10)) {
      const projected = projectSonority(frame.voicePitches, frame.bassPitch, target);
      assert.ok(validNativeVoices(projected.upper, target));
      assert.ok(projected.upper[0] - projected.bass >= nativeSpace(target).bassGap);
    }
  }
});

test('the explicitly chosen native triad relations preserve shared tones without a modulo-12 table', () => {
  for (const tuning of ['19edo', '24edo', '31edo'] as const) for (const op of ['P', 'R', 'L'] as const) {
    const before = harmonicPitchClasses(0, 'major', tuning), after = transformTriad(0, 'major', op, tuning);
    const tones = harmonicPitchClasses(after.root, after.quality, tuning);
    assert.equal(before.filter(note => tones.includes(note)).length, 2, `${tuning} ${op}`);
  }
});
