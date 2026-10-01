import test from 'node:test';
import assert from 'node:assert/strict';
import { degreeToPitch, midiToPitch, pitchToHz } from '../src/pitch';
import { SPECTRA, type Spectrum } from '../src/spectrum';
import { partialPairRoughness, partialsForPitches, rawRoughnessForPitches, roughnessForPitches } from '../src/roughness';

test('partial interaction is zero at unison, rises inside a critical band, and falls for wide separation', () => {
  const first = { frequency: 440, amplitude: 1 };
  const unison = partialPairRoughness(first, { frequency: 440, amplitude: 1 });
  const close = partialPairRoughness(first, { frequency: 466, amplitude: 1 });
  const octave = partialPairRoughness(first, { frequency: 880, amplitude: 1 });
  assert.equal(unison, 0); assert.ok(close > 0.8); assert.ok(octave < 0.00002);
  assert.equal(partialPairRoughness(first, { frequency: 466, amplitude: 0.5 }), close * 0.5);
});

test('shared partial expansion preserves every ratio and amplitude at native 19-EDO frequencies', () => {
  const pitch = degreeToPitch('19edo', 1);
  const spectrum = SPECTRA[1];
  const partials = partialsForPitches([pitch], spectrum);
  assert.equal(partials.length, 5);
  assert.deepEqual(partials, spectrum.partials.map(partial => ({ frequency: pitchToHz(pitch) * partial.ratio, amplitude: partial.amplitude })));
  assert.notEqual(pitchToHz(pitch), pitchToHz(midiToPitch(70)));
  assert.equal(partialsForPitches([pitch], { ...spectrum, partials: [{ ratio: 1, amplitude: 0 }] }).length, 0);
});

test('register and spectrum change modeled roughness for the same pitch relationships', () => {
  const harmonic = SPECTRA[0], stretched = SPECTRA[1];
  const interval = [60, 67].map(midiToPitch);
  const harmonicFifth = roughnessForPitches(interval, harmonic);
  const stretchedFifth = roughnessForPitches(interval, stretched);
  const semitone = roughnessForPitches([60, 61].map(midiToPitch), harmonic);
  assert.ok(stretchedFifth > harmonicFifth * 1.5);
  assert.ok(semitone > harmonicFifth * 4);
  const low = roughnessForPitches([40, 41].map(midiToPitch), harmonic);
  const high = roughnessForPitches([76, 77].map(midiToPitch), harmonic);
  assert.ok(Math.abs(low - high) > 0.02);
});

test('changing the spectrum reverses the roughness ranking of two 19-EDO intervals', () => {
  const root = degreeToPitch('19edo', -19); // A3, 220 Hz.
  const octave = [root, degreeToPitch('19edo', 0)];
  const octavePlusOneDegree = [root, degreeToPitch('19edo', 1)];
  const harmonicOctave = roughnessForPitches(octave, SPECTRA[0]);
  const harmonicWide = roughnessForPitches(octavePlusOneDegree, SPECTRA[0]);
  const stretchedOctave = roughnessForPitches(octave, SPECTRA[1]);
  const stretchedWide = roughnessForPitches(octavePlusOneDegree, SPECTRA[1]);
  assert.ok(harmonicOctave + 0.09 < harmonicWide, 'Harmonic spectrum prefers the octave.');
  assert.ok(stretchedOctave > stretchedWide + 0.04, 'Stretched spectrum prefers 20/19 of an octave.');
});

test('roughness is finite, bounded, exactly repeatable, and permutation-invariant', () => {
  const pitches = [48, 55, 60, 64, 69].map(midiToPitch);
  const value = roughnessForPitches(pitches, SPECTRA[0]);
  assert.ok(Number.isFinite(value) && value >= 0 && value < 1);
  assert.equal(roughnessForPitches([...pitches].reverse(), SPECTRA[0]), value);
  assert.equal(roughnessForPitches(pitches, SPECTRA[0]), value);
  assert.equal(roughnessForPitches([], SPECTRA[0]), 0);
  const raw = rawRoughnessForPitches(pitches, SPECTRA[0]);
  assert.equal(value, raw / (raw + 5));
});

test('intrinsic roughness and bounded-spectrum validation remain explicit', () => {
  const closePartials: Spectrum = { id: 'test', name: 'Close partials', partials: [{ ratio: 1, amplitude: 1 }, { ratio: 1.06, amplitude: 0.5 }] };
  assert.ok(rawRoughnessForPitches([midiToPitch(60)], closePartials) > 0.1);
  assert.throws(() => partialsForPitches([midiToPitch(60)], { ...closePartials, partials: Array(6).fill({ ratio: 1, amplitude: 1 }) }), /one to five/);
  assert.throws(() => partialsForPitches([midiToPitch(60)], { ...closePartials, partials: [{ ratio: -1, amplitude: 1 }] }), /positive/);
});
