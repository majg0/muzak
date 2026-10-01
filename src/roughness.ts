import { pitchToHz, type Pitch } from './pitch';
import type { Spectrum } from './spectrum';

export interface FrequencyPartial { frequency: number; amplitude: number; }

/** Expand the same bounded spectrum used by additive playback at actual Hz. */
export function partialsForPitches(pitches: Pitch[], spectrum: Spectrum): FrequencyPartial[] {
  if (!spectrum.partials.length || spectrum.partials.length > 5) throw new RangeError('A spectrum must contain one to five partials.');
  for (const partial of spectrum.partials) {
    if (!Number.isFinite(partial.ratio) || partial.ratio <= 0 || !Number.isFinite(partial.amplitude) || partial.amplitude < 0) {
      throw new RangeError('Spectral ratios must be positive and amplitudes non-negative.');
    }
  }
  return pitches.flatMap(pitch => {
    const fundamental = pitchToHz(pitch);
    if (!Number.isFinite(fundamental) || fundamental <= 0) throw new RangeError('Pitch must represent a finite positive frequency.');
    return spectrum.partials.filter(partial => partial.amplitude > 0).map(partial => ({ frequency: fundamental * partial.ratio, amplitude: partial.amplitude }));
  });
}

/** Sethares' fit to the Plomp–Levelt sensory dissonance curve.
 * Source and coefficients: https://sethares.engr.wisc.edu/comprog.html
 * Minimum-amplitude weighting follows that author's published implementation.
 * This estimates sensory roughness, not musical tension or aesthetic quality.
 */
export function partialPairRoughness(a: FrequencyPartial, b: FrequencyPartial): number {
  const lowest = Math.min(a.frequency, b.frequency);
  const scaledDistance = 0.24 * Math.abs(a.frequency - b.frequency) / (0.0207 * lowest + 18.96);
  return Math.min(a.amplitude, b.amplitude) * 5 * (Math.exp(-3.51 * scaledDistance) - Math.exp(-5.75 * scaledDistance));
}

/** Sum every unordered pair, including a timbre's own intrinsic roughness.
 * Absolute register matters because critical bandwidth varies with frequency.
 */
export function rawRoughnessForPitches(pitches: Pitch[], spectrum: Spectrum): number {
  const partials = partialsForPitches(pitches, spectrum).sort((a, b) => a.frequency - b.frequency || a.amplitude - b.amplitude);
  let sum = 0;
  for (let i = 0; i < partials.length; i++) for (let j = i + 1; j < partials.length; j++) sum += partialPairRoughness(partials[i], partials[j]);
  return sum;
}

/** Fixed monotonic UI/planner scale: r/(r+5). Five raw units map to 0.5.
 * This normalization is an explicit engineering convention, not a perceptual
 * probability. It is identical across tunings, registers, and spectra.
 */
export function roughnessForPitches(pitches: Pitch[], spectrum: Spectrum): number {
  const raw = rawRoughnessForPitches(pitches, spectrum);
  return raw / (raw + 5);
}
