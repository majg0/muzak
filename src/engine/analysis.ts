import type { HarmonicTensionDiagnostics, Parameters, TensionComponents } from '../types';

export const mod12 = (n: number): number => ((n % 12) + 12) % 12;
export const clamp = (n: number, min = 0, max = 1): number => Math.max(min, Math.min(max, n));
export const round = (n: number): number => Math.round(n * 1000000) / 1000000;
export const VOICE_RANGES = [[48, 67], [53, 72], [58, 77], [63, 84]] as const;
export const BASS_RANGE = [28, 52] as const;
const INTERVALLIC_FRICTION = [0, 1, 0.42, 0.11, 0.07, 0.12, 0.69, 0.025, 0.18, 0.12, 0.32, 0.74];
// A field, not a chord grammar: chromatic pitch classes have graded attraction.
const TONAL_FIELD = [1, 0.10, 0.65, 0.38, 0.82, 0.66, 0.24, 0.94, 0.28, 0.67, 0.40, 0.57];
const MINOR_FIELD = [1, 0.10, 0.65, 0.82, 0.28, 0.66, 0.24, 0.94, 0.55, 0.58, 0.65, 0.38];

export function voiceLeadingDistance(a: number[], b: number[]): number {
  return a.reduce((sum, pitch, i) => sum + Math.abs(pitch - b[i]), 0);
}

export function validVoices(voices: number[]): boolean {
  return voices.length === 4 && voices.every((v, i) => Number.isInteger(v) && v >= VOICE_RANGES[i][0] && v <= VOICE_RANGES[i][1] && (i === 0 || v - voices[i - 1] >= 2 && v - voices[i - 1] <= 14)) && voices[3] - voices[0] <= 31;
}

export function pitchClassMask(voices: number[], bass?: number): number {
  return [...voices, ...(bass === undefined ? [] : [bass])].reduce((mask, p) => mask | 1 << mod12(p), 0);
}

export function bitCount(value: number): number {
  let n = value, count = 0;
  while (n) { n &= n - 1; count++; }
  return count;
}

export function harmonicDistance(a: number[], bassA: number, b: number[], bassB: number): number {
  const maskA = pitchClassMask(a, bassA), maskB = pitchClassMask(b, bassB);
  const changedCollection = bitCount(maskA ^ maskB) / Math.max(1, bitCount(maskA | maskB));
  // A bass can reinterpret unchanged upper voices. Semitone displacement is not
  // equivalent to harmonic distance: nearby bass pitches can be very remote.
  const bassDelta = mod12(bassA - bassB);
  const bassColor = [0, 1, 0.72, 0.55, 0.49, 0.35, 0.95, 0.35, 0.49, 0.55, 0.72, 1][bassDelta];
  return round(0.72 * changedCollection + 0.28 * bassColor);
}

export function dissonance(voices: number[], bass: number): number {
  let score = 0, weight = 0;
  const pitches = [bass, ...voices];
  for (let i = 0; i < pitches.length; i++) for (let j = i + 1; j < pitches.length; j++) {
    const interval = pitches[j] - pitches[i];
    const registerWeight = i === 0 ? 1.35 : interval < 12 ? 1.1 : 0.8;
    const closePenalty = interval <= 2 ? 0.16 : 0;
    score += (INTERVALLIC_FRICTION[mod12(interval)] + closePenalty) * registerWeight;
    weight += registerWeight;
  }
  return round(clamp(score / weight * 1.72));
}

export function tonalFit(voices: number[], bass: number, center: number, third: 3 | 4 = 4): number {
  const field = third === 3 ? MINOR_FIELD : TONAL_FIELD;
  const upper = voices.reduce((sum, p) => sum + field[mod12(p - center)], 0) / voices.length;
  return round(0.72 * upper + 0.28 * field[mod12(bass - center)]);
}

export function estimatedCenter(voices: number[], bass: number, preferred: number, third: 3 | 4 = 4): { center: number; clarity: number } {
  const scores = Array.from({ length: 12 }, (_, center) => ({ center, fit: tonalFit(voices, bass, center, third) + (center === preferred ? 0.05 : 0) })).sort((a, b) => b.fit - a.fit || a.center - b.center);
  return { center: scores[0].center, clarity: round(clamp((scores[0].fit - scores[1].fit) * 6 + (scores[0].fit - 0.5) * 0.65)) };
}

/** Integer-phase triangular waves avoid accumulating compositional clock error. */
export function triangle(index: number, period: number): number {
  const phase = ((index % period) + period) % period / period;
  return 1 - Math.abs(phase * 2 - 1);
}

export function targetTension(index: number, p: Parameters): number {
  const event = triangle(index + 1, 4);
  const phrase = triangle(index, 8);
  const section = triangle(index + 8, 32);
  const longForm = triangle(index + 32, 128);
  const release = index % 8 === 7 ? -0.11 * p.metricStability : 0;
  return round(clamp(p.tension * 0.68 + event * 0.07 + phrase * 0.13 + section * 0.09 + longForm * 0.06 + release - 0.12, 0.04, 0.92));
}

export function tensionComponents(voices: number[], bass: number, previous: number[], p: Parameters, center: number, index: number, third: 3 | 4 = 4): TensionComponents {
  return {
    harmonic: dissonance(voices, bass),
    ambiguity: round(1 - tonalFit(voices, bass, center, third)),
    rhythmic: round(clamp(p.rhythmicComplexity * 0.55 + (1 - p.metricStability) * 0.30 + p.rhythmicDensity * 0.15)),
    register: round(clamp((voices.reduce((a, b) => a + b, 0) / 4 - 56) / 25)),
    density: round(p.texturalDensity * 0.7 + p.melodicActivity * 0.3),
    instability: round(clamp(voiceLeadingDistance(voices, previous) / 18)),
    cadential: round(triangle(index, 8) * 0.65 + triangle(index, 32) * 0.35),
  };
}

export function aggregateTension(c: TensionComponents): number {
  return round(clamp(c.harmonic * 0.34 + c.ambiguity * 0.17 + c.rhythmic * 0.1 + c.register * 0.07 + c.density * 0.08 + c.instability * 0.11 + c.cadential * 0.13));
}

/** A harmonic objective contains only properties a pitch continuation can
 * change. Ensemble density, loudness and phrase position are deliberately not
 * included: requesting a loud climax does not require dissonant harmony.
 *
 * Targets express the compatible intent of the controls, rather than asking
 * one aggregate to override separate penalties for exactly those properties.
 * Friction retains its native meaning: 12-TET intervallic friction, or 19-EDO
 * physical crowding. Neither this value nor the legacy total is audio loudness.
 */
export function harmonicTensionDiagnostics(c: TensionComponents, p: Parameters, requestedDrive: number,
  tuning: import('../pitch').TuningId = '12tet'): HarmonicTensionDiagnostics {
  const drive = clamp(requestedDrive);
  const friction = tuning !== '12tet'
    ? .025 + p.dissonance * (.13 + drive * .1) + drive * .045
    : .025 + p.dissonance * (.5 + drive * .3) + drive * .2;
  const ambiguity = .035 + (1 - p.tonalClarity) * (.17 + drive * .3) + (1 - p.tonalGravity) * .07;
  const motion = (.025 + drive * .18) * (1 - p.voiceLeading * .78);
  const components = {
    friction: { actual: c.harmonic, target: round(clamp(friction)) },
    ambiguity: { actual: c.ambiguity, target: round(clamp(ambiguity)) },
    motion: { actual: c.instability, target: round(clamp(motion)) },
  };
  const combine = (kind: 'actual' | 'target') => round(clamp(components.friction[kind] * .65
    + components.ambiguity[kind] * .25 + components.motion[kind] * .1));
  return { actual: combine('actual'), target: combine('target'), components };
}
