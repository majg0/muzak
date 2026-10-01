import test from 'node:test';
import assert from 'node:assert/strict';
import { melodySupport12, melodySupport19 } from '../src/engine/melody-support';
import { DEFAULT_PARAMETERS, DEFAULT_WEIGHTS } from '../src/parameters';
import { plan, scoreCandidate, type HarmonicState } from '../src/engine/planner';
import { degreeToPitch } from '../src/pitch';
import { tonalFit } from '../src/engine/analysis';

test('melodic support favors a compatible foreground note while retaining extensions', () => {
  const voices = [55, 60, 64, 67];
  assert.ok(melodySupport12(voices, 36, [7600]) > melodySupport12(voices, 36, [7300]) + .25);
  assert.ok(melodySupport12(voices, 36, [7400]) > .5, 'The ninth can be a supported extension.');
  assert.equal(melodySupport12(voices, 36, []), 0);
  assert.equal(melodySupport12(voices, 36, [7600]), melodySupport12(voices, 36, [8800]));
});

test('the lead objective changes harmonic continuation and lives in musical structure', () => {
  const state: HarmonicState = { voices: [55, 60, 64, 69], bass: 36, center: 0, index: 4, recent: [] };
  const p = { ...DEFAULT_PARAMETERS, voiceLeading: .99, tonalClarity: .4 };
  const intent = { targetTension: .4, melodyTargetsCents: [7300], melodySupport: 1 };
  const off = scoreCandidate(state, state.voices, state.bass, p, DEFAULT_WEIGHTS, 0, undefined, { targetTension: .4 });
  const on = scoreCandidate(state, state.voices, state.bass, p, DEFAULT_WEIGHTS, 0, undefined, intent);
  assert.equal(on.scores.dissonance, off.scores.dissonance);
  assert.equal(on.scores.tension, off.scores.tension);
  assert.notEqual(on.scores.structure, off.scores.structure);
  const continueUnder = (target: number) => {
    let current = structuredClone(state);
    return Array.from({ length: 8 }, () => {
      const previous = current;
      current = plan('lead-listening', current, () => p, DEFAULT_WEIGHTS, undefined, () => ({ ...intent, melodyTargetsCents: [target] })).winner.state;
      current.voices.forEach((pitch, index) => assert.ok(Math.abs(pitch - previous.voices[index]) <= 2));
      return [...current.voices, current.bass];
    });
  };
  const a = continueUnder(7300), b = continueUnder(7600);
  assert.ok(a.filter((voicing, index) => voicing.some((pitch, voice) => pitch !== b[index][voice])).length >= 5);
});

test('19-EDO melodic support uses physical interval locations without semitone rounding', () => {
  const cents = (degree: number) => degreeToPitch('19edo', degree).millicents / 1000;
  const upper = [0, 8, 11, 19], bass = -19;
  assert.ok(melodySupport19(upper, bass, [cents(0)]) > melodySupport19(upper, bass, [cents(1)]));
  assert.notEqual(melodySupport19(upper, bass, [cents(1)]), melodySupport19(upper, bass, [Math.round(cents(1) / 100) * 100]));
  for (let degree = -30; degree <= 30; degree++) {
    const score = melodySupport19(upper, bass, [cents(degree)]);
    assert.ok(Number.isFinite(score) && score >= 0 && score <= 1);
  }
});

test('a minor motif carries its third into the tonal field instead of being judged against a major field', () => {
  assert.ok(tonalFit([55, 60, 63, 67], 36, 0, 3) > tonalFit([55, 60, 63, 67], 36, 0, 4));
  assert.ok(tonalFit([55, 60, 64, 67], 36, 0, 4) > tonalFit([55, 60, 64, 67], 36, 0, 3));
});
