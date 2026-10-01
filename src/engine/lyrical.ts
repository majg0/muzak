import type { Parameters } from '../types';
import type { TuningId } from '../pitch';
import type { HarmonyConfig } from '../harmonic-language';
import { composeThemeCore, realizeThemeCore, type ThemeCore, type ThemeNoteRole, type ThemeDevelopmentPolicy,
  type ThemeArgumentPolicy, type ThemeArgumentRealization } from './theme-core';

export type MelodicFunction = 'quote' | 'development' | 'approach' | 'arrival';
export interface LyricalNote {
  tick: number; duration: number; cents: number; degree: number;
  accent: number; landing: boolean; protectedTheme: true; function: MelodicFunction;
  sourceId: string;
  endCents?: number; glideTicks?: number; articulation?: 'sustained' | 'connected' | 'detached';
  coreRole?: ThemeNoteRole;
  corePurpose?: string;
}
export interface LyricalSegment {
  startTick: number; endTick: number; label: string; role: 'question' | 'answer';
  sourceId: string; notes: LyricalNote[];
}
export interface LyricalSentence {
  notes: LyricalNote[];
  segments: LyricalSegment[];
  headId: string;
  highPointTick: number;
  rests: Array<{ startTick: number; endTick: number; reason: string }>;
  realization?: ThemeArgumentRealization;
}
export interface LyricalInput {
  seed: string; themeId: string; occurrence: number;
  startTick: number; endTick: number; barTicks: number; beatTicks: number;
  tuning: TuningId; third: 3 | 4; parameters: Parameters;
  cadence?: 'open' | 'closed';
  themeCore?: ThemeCore;
  treatment?: HarmonyConfig['treatment'];
  development?: ThemeDevelopmentPolicy;
  argument?: ThemeArgumentPolicy;
}
/** Every occurrence realizes a reusable whole thematic argument. Runtime delivery
 * adds its own named ornaments without rewriting this source. */
export function planLyricalSentence(input: LyricalInput): LyricalSentence {
  return realizeThemeCore(input.themeCore ?? composeThemeCore(input.seed, input.themeId, input.third), {
    startTick: input.startTick, endTick: input.endTick, tuning: input.tuning, occurrence: input.occurrence,
    cadence: input.cadence ?? 'closed', treatment: input.treatment ?? 'develop',
    development: input.development, beatTicks: input.beatTicks,
    argument: input.argument,
  });
}
