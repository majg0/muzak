import type { ToolCoverage } from './engine/idea-selection';

/** Performance policy, independent of pitch space and of the UI. These controls
 * shape relationships between ideas; the phrase controls shape local delivery. */
export interface CompositionConfig {
  development: number;
  repetition: number;
  embellishment: number;
  cohesion: number;
  accent: number;
  dynamicRange: number;
  /** Optional on recipe input so six-control recipes can be normalized. */
  displacement?: number;
  polymeter?: number;
  transition?: number;
}

export const DEFAULT_COMPOSITION: Required<CompositionConfig> = {
  development: .68, repetition: .65, embellishment: .55,
  cohesion: .8, accent: .72, dynamicRange: .65,
  displacement: .72, polymeter: .58, transition: .55,
};

export const COMPOSITION_CONTROLS = [
  ['development', 'Length of thought', 'Build longer phrases from several motifs, with open inner endings.'],
  ['repetition', 'Thematic repetition', 'Return to a group of phrases before moving on; each pass can be dressed differently.'],
  ['embellishment', 'Embellishment', 'Add passing notes, neighbors and varied articulations around the tune’s structural notes.'],
  ['cohesion', 'Ensemble togetherness', 'Let bass, harmony and percussion agree on important entrances and arrivals.'],
  ['accent', 'Accent contrast', 'Bring out structural melody notes and rhythmic accents above their surrounding detail.'],
  ['dynamicRange', 'Dynamic breadth', 'Shape larger swells and quieter replies independently of the overall Dynamics level.'],
  ['displacement', 'Independent layers', 'Let a counterline enter and continue on its own cycle around the main idea.'],
  ['polymeter', 'Cross-meter cycles', 'Set repeating layers against the bar while keeping the shared pulse steady.'],
  ['transition', 'Transition energy', 'Shape pickups, fills, rolls and releases around changes of section or meter.'],
] as const;

export function normalizeComposition(input: Partial<CompositionConfig> = {}): Required<CompositionConfig> {
  const values = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  return Object.fromEntries(COMPOSITION_CONTROLS.map(([key]) => [key,
    typeof values[key] === 'number' && Number.isFinite(values[key])
      ? Math.max(0, Math.min(1, values[key]!)) : DEFAULT_COMPOSITION[key],
  ])) as unknown as Required<CompositionConfig>;
}

export function validateComposition(input: unknown): Required<CompositionConfig> {
  if (input === undefined) return { ...DEFAULT_COMPOSITION };
  if (input === null || typeof input !== 'object' || Array.isArray(input)) throw new Error('Composition must be an object.');
  const values = input as Record<string, unknown>;
  const keys = COMPOSITION_CONTROLS.map(([key]) => key);
  if (Object.keys(values).some(key => !keys.includes(key as keyof CompositionConfig))) throw new Error('Composition contains an unknown control.');
  for (const key of keys) {
    if (['displacement', 'polymeter', 'transition'].includes(key) && !Object.prototype.hasOwnProperty.call(values, key)) continue;
    if (typeof values[key] !== 'number' || !Number.isFinite(values[key]) || values[key] < 0 || values[key] > 1) throw new Error(`Composition ${key} must be a finite number between 0 and 1.`);
  }
  return normalizeComposition(values as unknown as CompositionConfig);
}

/** A deliberately sparse agreement at a real musical attack. Exact integer
 * ticks are shared across the orchestra; groove remains independent elsewhere. */
export interface StructuralCue {
  id: string;
  tick: number;
  endTick?: number;
  kind: 'entry' | 'accent' | 'arrival' | 'release' | 'break';
  strength: number;
  leadVoice?: number;
  ensemble?: 'punctuation' | 'cell';
  sourceId?: string;
}

export interface ShortPhraseSnapshot {
  id: string;
  sourceId: string;
  motifId: string;
  startTick: number;
  endTick: number;
  cycleTicks: number;
  transpositionCents: number;
  intervalScale: number;
  coreNotes: number;
}

export interface IndependentLayerSnapshot {
  id: string;
  role: 'counter' | 'rhythm';
  sourceId: string;
  label: string;
  cycleTicks: number;
  cycleStartTick: number;
  cycleEndTick: number;
  active: boolean;
  /** Present only after a real gesture has been evaluated and committed. */
  evaluation?: Record<string, number>;
  candidatesEvaluated?: number;
  relationship?: string;
  coverage?: ToolCoverage;
}

export interface TransitionSnapshot {
  boundaryTick: number;
  startTick: number;
  endTick: number;
  kind: 'pickup' | 'fill' | 'roll' | 'release';
  reason: 'section' | 'meter' | 'tempo';
  energy: number;
}

export interface CompositionSnapshot {
  movementId: string;
  movementName: string;
  movementIndex: number;
  themeId: string;
  themeName: string;
  themeStartTick: number;
  themeEndTick: number;
  phraseId: string;
  sourcePhraseId: string;
  phraseFunction: string;
  phraseOrdinal: number;
  phraseCount: number;
  iteration: number;
  treatment: string;
  cadence: 'open' | 'closed';
  motifs: Array<{ id: string; sourceId: string; startTick: number; endTick: number; treatment: string;
    parentId?: string; goalDegree?: number; relationship?: string; attackCount?: number }>;
  /** Source relationships actually consumed by the occurrence compiler. */
  fingerprint?: { sourceId: string; intervals: number[]; rhythmUnits: number[] };
  cues: StructuralCue[];
  shortPhrases?: ShortPhraseSnapshot[];
  layers?: IndependentLayerSnapshot[];
  transition?: TransitionSnapshot;
  /** Actual current-frame participation in an announced ensemble fill. */
  fills?: Array<{ id: string; boundaryTick: number; startTick: number; endTick: number;
    shape: string; energy: number;
    parts: Array<'harmony' | 'bass' | 'melody' | 'percussion'>; sharedTicks: number[] }>;
}
