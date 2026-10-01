import { clamp, mod12, round } from './analysis';
import { TUNINGS, type TuningId } from '../pitch';

// A 12-TET arrangement preference for supporting a foreground melody. These
// are interval relations, not spectral roughness and not a tuning-independent
// music theory. Long melody notes can be extensions as well as common tones.
const SUPPORT_12 = [1, .04, .54, .86, .90, .70, .24, .96, .76, .78, .60, .27];
export function melodySupport12(voices: readonly number[], bass: number, targetsCents: readonly number[]): number {
  if (!targetsCents.length) return 0;
  const fits = targetsCents.map(cents => {
    const melody = Math.round(cents / 100);
    const upper = voices.map(pitch => SUPPORT_12[mod12(melody - pitch)]);
    return upper.reduce((sum, value) => sum + value, 0) / upper.length * .6
      + SUPPORT_12[mod12(melody - bass)] * .25 + Math.max(...upper) * .15;
  });
  return round(fits.reduce((sum, value) => sum + value, 0) / fits.length);
}

/** In 19-EDO the hypothesis is only open physical spacing and near-common
 * tones. No twelve-entry table is relabeled as nineteen-tone harmony. */
export function melodySupport19(upperDegrees: readonly number[], bassDegree: number, targetsCents: readonly number[]): number {
  return melodySupportNative(upperDegrees, bassDegree, targetsCents, '19edo');
}
export function melodySupportNative(upperDegrees: readonly number[], bassDegree: number, targetsCents: readonly number[], tuning: TuningId): number {
  if (!targetsCents.length) return 0;
  const pitches = [bassDegree, ...upperDegrees].map(degree => 6900 + degree * 1200 / TUNINGS[tuning].divisions);
  const closeness = (a: number, b: number) => {
    const interval = ((a - b) % 1200 + 1200) % 1200;
    const open = Math.min(...[0, 500, 700, 1200].map(target => Math.abs(interval - target)));
    // Fifths/fourths retain wide tolerance, while close non-unisons carry less
    // support. This does not try to make every pair maximally consonant.
    return clamp(1 - open / 360, .12, 1);
  };
  return round(targetsCents.reduce((sum, target) => sum + pitches.reduce((fit, pitch) => fit + closeness(target, pitch), 0) / pitches.length, 0) / targetsCents.length);
}
