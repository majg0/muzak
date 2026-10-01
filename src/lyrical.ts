import { DEFAULT_CONDUCTOR } from './conductor';
import { DEFAULT_COMPOSITION } from './composition';
import { DEFAULT_PHRASING } from './phrasing';
import { DEFAULT_HARMONY } from './harmonic-language';
import { normalizeParameters } from './parameters';
import { newSeedPerformance } from './sessions';
import { resolveCompositionProfile } from './composition-profile';
import type { Performance } from './types';

/** A reproducible recipe for the common composer, favoring connected themes,
 * restrained embellishment and harmonic support for their held tones.
 * Existing sound/tuning choices are respected; automatic tuning travel is off. */
export function lyricalPerformance(source: Performance, seed = source.seed): { recipe: Performance; description: string } {
  const recipe = newSeedPerformance(source, seed);
  recipe.presetId = 'lyrical-score';
  recipe.initialParameters = normalizeParameters({ ...source.initialParameters,
    tension: .24, harmonicMobility: .28, harmonicSurprise: .12, voiceLeading: .99,
    tonalClarity: .96, tonalGravity: .96, dissonance: .06, chromaticism: .025,
    brightness: .55, intervalComplexity: .3, quartalTendency: .15,
    bassIndependence: .18, bassMobility: .24, melodicActivity: .28,
    melodicFamiliarity: .96, motifRecurrence: .88, motifTransformation: .12,
    rhythmicComplexity: .12, rhythmicPredictability: .91, rhythmicDensity: .13,
    metricStability: .96, texturalDensity: .4, dynamics: .62,
    tempo: Math.min(96, Math.max(64, source.initialParameters.tempo)),
  });
  recipe.conductor = { ...DEFAULT_CONDUCTOR, enabled: true, amount: .28, pace: .3, tuningTravel: false };
  recipe.phrasing = { ...DEFAULT_PHRASING, enabled: true, character: 'lyrical',
    harmony: { ...DEFAULT_HARMONY },
    space: .28, syncopation: .08, interplay: .15, virtuosity: .1,
    renewal: .18, variation: .1, distribution: 'focused', arc: 'arch',
    composition: { ...DEFAULT_COMPOSITION, development: .9, repetition: .84, embellishment: .12,
      cohesion: .86, accent: .32, dynamicRange: .88, displacement: .2, polymeter: 0, transition: .35 } };
  recipe.automation = [];
  delete recipe.automationRevisions;
  Object.assign(recipe, resolveCompositionProfile(recipe));
  return { recipe, description: 'Strong melodic cores · directed harmony · recognizable transformations' };
}
