import { DEFAULT_CONDUCTOR, type ConductorConfig } from './conductor';
import { normalizeComposition, type CompositionConfig } from './composition';
import { normalizeHarmony, type HarmonyConfig } from './harmonic-language';
import { normalizePhrasing, type PhraseConfig } from './phrasing';

export interface CompositionProfile {
  conductor: ConductorConfig;
  phrasing: PhraseConfig & { composition: Required<CompositionConfig>; harmony: HarmonyConfig };
}

/** One boundary for old recipes and partial library inputs. Runtime components
 * are always present. Freedom zero holds the intention steady; it does not
 * remove form, thematic identity, harmonic support or orchestral agreement. */
export function resolveCompositionProfile(input: { conductor?: ConductorConfig; phrasing?: PhraseConfig }): CompositionProfile {
  const source = input.conductor ?? { ...DEFAULT_CONDUCTOR, amount: .48, pace: .4, tuningTravel: false };
  const unit = (value: number, fallback: number) => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback;
  const phrasing = normalizePhrasing(input.phrasing);
  return {
    conductor: { enabled: true, amount: source.enabled === false ? 0 : unit(source.amount, .48),
      pace: unit(source.pace, .4), tuningTravel: source.enabled !== false && Boolean(source.tuningTravel) },
    phrasing: { ...phrasing, enabled: true, character: 'lyrical',
      composition: normalizeComposition(phrasing.composition), harmony: normalizeHarmony(phrasing.harmony) },
  };
}
