import { random } from './engine/random';
import { normalizeHarmony, validateHarmony, type HarmonyConfig } from './harmonic-language';
import type { ThemeCoreSnapshot } from './engine/theme-core';
import { DEFAULT_COMPOSITION, normalizeComposition, validateComposition, type CompositionConfig, type CompositionSnapshot } from './composition';

export type DistributionShape = 'focused' | 'balanced' | 'adventurous';
export type EnvelopeShape = 'arch' | 'rise' | 'fall' | 'waves';

export interface PhraseConfig {
  enabled: boolean;
  /** Legacy recipe label. All runtime characters share thematic composition. */
  character?: 'lyrical' | 'exploratory';
  /** Partial/older inputs are resolved at the composition boundary. */
  harmony?: HarmonyConfig;
  space: number;
  syncopation: number;
  interplay: number;
  virtuosity: number;
  renewal: number;
  variation: number;
  distribution: DistributionShape;
  arc: EnvelopeShape;
  composition?: CompositionConfig;
}

export const DEFAULT_PHRASING: PhraseConfig = {
  enabled: true, space: .55, syncopation: .6, interplay: .65,
  virtuosity: .6, renewal: .45, variation: .35, distribution: 'balanced', arc: 'arch',
  composition: { ...DEFAULT_COMPOSITION },
};
export const MANUAL_PHRASING: PhraseConfig = { ...DEFAULT_PHRASING, composition: { ...DEFAULT_COMPOSITION }, enabled: false };

export interface EnvelopePoint { position: number; value: number; }
export interface PhraseEnvelope {
  key: 'activity' | 'intensity' | 'register';
  points: EnvelopePoint[];
  spread: number;
  realized: EnvelopePoint[];
}
export interface PhraseRest {
  startTick: number;
  endTick: number;
  scope: 'lead' | 'ensemble' | 'accompaniment';
  reason: string;
  /** Omitted means the whole scope. A foreground breath can leave an
   * independently phrased melodic layer sounding. */
  voices?: number[];
  /** A roster exit releases sources but is not a compositional breath. */
  kind?: 'player-exit';
}

export function restAppliesToNote(note: { part: string; voice: number }, rest: PhraseRest): boolean {
  if (rest.voices && !rest.voices.includes(note.voice)) return false;
  return rest.scope === 'ensemble' || (rest.scope === 'lead' ? note.part === 'melody' : note.part !== 'melody');
}
export interface PhraseCell {
  startTick: number;
  endTick: number;
  role: 'theme' | 'counter' | 'solo' | 'bass' | 'drums';
  label: string;
  ideaId: string;
}
export interface RememberedIdea {
  id: string;
  name: string;
  bornPhrase: number;
  lastHeardPhrase: number;
  uses: number;
  role: string;
  sourceId?: string;
  signature?: string;
  contour?: string;
  lineage?: string;
}
export interface PhraseSnapshot {
  themeCore?: ThemeCoreSnapshot;
  phraseId: number;
  startTick: number;
  endTick: number;
  gesture: string;
  leadRole: 'theme' | 'solo' | 'answer' | 'landscape';
  themeId: string;
  themeName: string;
  relationship: string;
  grooveId: string;
  envelopes: PhraseEnvelope[];
  rests: PhraseRest[];
  cells: PhraseCell[];
  ideas: RememberedIdea[];
  distribution: DistributionShape;
  variation: number;
  composition?: CompositionSnapshot;
}

const CONTROL_KEYS = ['space', 'syncopation', 'interplay', 'virtuosity', 'renewal', 'variation'] as const;
const DISTRIBUTIONS: readonly DistributionShape[] = ['focused', 'balanced', 'adventurous'];
const ARCS: readonly EnvelopeShape[] = ['arch', 'rise', 'fall', 'waves'];
const CONFIG_KEYS = ['enabled', ...CONTROL_KEYS, 'distribution', 'arc', 'composition', 'character', 'harmony'];
const clamp = (value: number) => Math.max(0, Math.min(1, value));
const unit = (value: unknown, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? clamp(value) : fallback;
const quantize = (value: number) => Math.round(value * 1_000_000) / 1_000_000;

/** Tolerant normalization for interactive controls; imports use validatePhrasing. */
export function normalizePhrasing(input: Partial<PhraseConfig> = {}): PhraseConfig {
  const result: PhraseConfig = { ...DEFAULT_PHRASING, composition: normalizeComposition(input.composition && typeof input.composition === 'object' && !Array.isArray(input.composition) ? input.composition : undefined) };
  for (const key of CONTROL_KEYS) result[key] = unit(input[key], DEFAULT_PHRASING[key]);
  if (typeof input.enabled === 'boolean') result.enabled = input.enabled;
  if (DISTRIBUTIONS.includes(input.distribution!)) result.distribution = input.distribution!;
  if (ARCS.includes(input.arc!)) result.arc = input.arc!;
  if (input.character === 'lyrical' || input.character === 'exploratory') result.character = input.character;
  if (input.harmony) result.harmony = normalizeHarmony(input.harmony);
  return result;
}

/** Missing controls preserve recipes created before phrase orchestration existed. */
export function validatePhrasing(input: unknown): PhraseConfig {
  if (input === undefined) return normalizePhrasing(MANUAL_PHRASING);
  if (input === null || typeof input !== 'object' || Array.isArray(input)) throw new Error('Phrasing must be an object.');
  const value = input as Record<string, unknown>;
  if (Object.keys(value).some(key => !CONFIG_KEYS.includes(key))) throw new Error('Phrasing contains an unknown control.');
  if (typeof value.enabled !== 'boolean') throw new Error('Phrasing enabled must be a boolean.');
  if (value.character !== undefined && value.character !== 'lyrical' && value.character !== 'exploratory') throw new Error('Unknown phrasing character.');
  for (const key of CONTROL_KEYS) {
    if (typeof value[key] !== 'number' || !Number.isFinite(value[key]) || value[key] < 0 || value[key] > 1) {
      throw new Error(`Phrasing ${key} must be a finite number between 0 and 1.`);
    }
  }
  if (!DISTRIBUTIONS.includes(value.distribution as DistributionShape)) throw new Error('Unknown phrasing distribution.');
  if (!ARCS.includes(value.arc as EnvelopeShape)) throw new Error('Unknown phrasing arc.');
  const composition = validateComposition(value.composition);
  const harmony = validateHarmony(value.harmony);
  return normalizePhrasing({ ...value, composition, harmony } as unknown as PhraseConfig);
}

/** Piecewise-linear envelope; positions and values use the normalized unit range. */
export function envelopeAt(points: readonly EnvelopePoint[], position: number): number {
  if (points.length === 0) return 0;
  const at = unit(position, 0);
  if (at < points[0].position) return points[0].value;
  for (let index = 1; index < points.length; index++) {
    const left = points[index - 1], right = points[index];
    if (at < right.position) {
      const fraction = (at - left.position) / (right.position - left.position);
      return quantize(left.value + (right.value - left.value) * fraction);
    }
  }
  return points[points.length - 1].value;
}

const ENVELOPES: Record<EnvelopeShape, readonly (readonly [number, number])[]> = {
  arch: [[0, -1], [.25, .15], [.5, 1], [.75, .15], [1, -1]],
  rise: [[0, -1], [1, 1]],
  fall: [[0, 1], [1, -1]],
  waves: [[0, -.5], [.2, .8], [.4, -.6], [.65, 1], [.85, -.3], [1, -.7]],
};

export function makeEnvelope(shape: EnvelopeShape, center: number, amplitude: number): EnvelopePoint[] {
  const middle = unit(center, .5), range = unit(amplitude, 0);
  return ENVELOPES[shape].map(([position, height]) => ({ position, value: quantize(clamp(middle + range * height)) }));
}

/** Normalized probability density on [-1, 1], before mapping to control support. */
export function densityAt(x: number, shape: DistributionShape): number {
  if (!Number.isFinite(x) || x < -1 || x > 1) return 0;
  return shape === 'focused' ? 1 - Math.abs(x) : shape === 'adventurous' ? Math.abs(x) : .5;
}

function inverseDistribution(probability: number, shape: DistributionShape): number {
  if (shape === 'focused') return probability < .5 ? -1 + Math.sqrt(2 * probability) : 1 - Math.sqrt(2 * (1 - probability));
  if (shape === 'adventurous') return probability < .5 ? -Math.sqrt(1 - 2 * probability) : Math.sqrt(2 * probability - 1);
  return 2 * probability - 1;
}

/**
 * Addressed inverse-CDF sampling, with no mutable stream or rejected draws.
 * Spread is a support radius. Near a boundary the available support shifts
 * inward: mapping the whole density there avoids a pile of clipped samples.
 * Quantization fixes the control precision; it does not quantize musical time.
 */
export function sampleIntent(seed: string, phraseId: number, domain: string, center: number, spread: number, shape: DistributionShape): number {
  if (!Number.isSafeInteger(phraseId) || phraseId < 0) throw new RangeError('Phrase ID must be a non-negative integer.');
  const middle = unit(center, .5), radius = unit(spread, 0);
  const low = Math.max(0, middle - radius), high = Math.min(1, middle + radius);
  if (low === high) return quantize(low);
  // Midpoint quantiles of 2^32 bins exclude both endpoints without biased clamping.
  const quantile = random(seed, 'phrase-intent', phraseId, domain) + 1 / 8_589_934_592;
  const standardized = inverseDistribution(quantile, shape);
  return quantize(low + (standardized + 1) * .5 * (high - low));
}
