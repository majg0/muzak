import { random } from './engine/random';
import { DEFAULT_CONDUCTOR, formAt } from './conductor';
import { openingGesture } from './form-score';
import { normalizeComposition } from './composition';
import { DEFAULT_PHRASING } from './phrasing';
import { normalizeParameters } from './parameters';
import { newSeedPerformance } from './sessions';
import { resolveCompositionProfile } from './composition-profile';
import type { Performance } from './types';

/** Wide exploration composes a new parameter recipe, rather than setting all
 * seeds to the same maximum-freedom preset. Correlated axes make contrast
 * intelligible; every resulting setting is ordinary serialized recipe data.
 * The user's chosen tempo, tuning/spectrum and scoring controls stay explicit. */
export function explorationPerformance(source: Performance, seed: string): { recipe: Performance; description: string } {
  const recipe = newSeedPerformance(source, seed);
  const draw = (axis: string) => random(seed, 'exploration-character', axis);
  const space = draw('space'), drive = draw('drive'), lyric = draw('lyricism');
  const friction = draw('friction'), motion = draw('motion'), weave = draw('interlock');
  const opening = openingGesture(seed);
  const preferences = {
    attack: [.55, .25, .65, .22], soliloquy: [.2, .22, .12, .16], drive: [.2, .18, .4, .25],
    swarm: [.72, .2, .6, .2], air: [.15, .23, .2, .23], panorama: [.2, .25, .7, .18],
  }[opening];
  const p = normalizeParameters({
    tension: .12 + drive * .64, harmonicMobility: .25 + motion * .7,
    harmonicSurprise: .12 + motion * .6, voiceLeading: .78 + draw('legato') * .21,
    tonalClarity: .2 + lyric * .75, tonalGravity: .25 + lyric * .7,
    dissonance: .025 + friction * .65, chromaticism: .06 + friction * .77,
    brightness: .2 + draw('light') * .7, intervalComplexity: .25 + weave * .65,
    quartalTendency: draw('fourths'), bassIndependence: .15 + motion * .75,
    bassMobility: .18 + drive * .62, melodicActivity: .25 + (1 - space) * .6,
    melodicFamiliarity: .5 + lyric * .48, motifRecurrence: .3 + lyric * .55,
    motifTransformation: .18 + weave * .7, rhythmicComplexity: .1 + weave * .85,
    rhythmicPredictability: .25 + (1 - weave) * .7, rhythmicDensity: .08 + drive * .8,
    metricStability: .2 + (1 - weave) * .75, texturalDensity: .18 + (1 - space) * .75,
    dynamics: .2 + drive * .7, tempo: source.initialParameters.tempo,
    ideaDensity: preferences[0] + draw('idea-density') * preferences[1],
    ensembleSize: preferences[2] + draw('ensemble-size') * preferences[3],
  });
  recipe.initialParameters = p;
  recipe.presetId = 'wide-exploration';
  recipe.conductor = { ...(source.conductor ?? DEFAULT_CONDUCTOR), enabled: true,
    amount: .8 + draw('freedom') * .2, pace: .2 + draw('pace') * .6, tuningTravel: true };
  recipe.phrasing = { ...(source.phrasing ?? DEFAULT_PHRASING), enabled: true,
    character: 'lyrical',
    space: .18 + space * .66, syncopation: .22 + weave * .74,
    interplay: .3 + weave * .65, virtuosity: .25 + drive * .72,
    renewal: .4 + draw('renewal') * .56, variation: .22 + draw('variation') * .73,
    distribution: draw('distribution') < .35 ? 'focused' : draw('distribution') < .7 ? 'balanced' : 'adventurous',
    arc: (['arch', 'rise', 'fall', 'waves'] as const)[Math.floor(draw('arc') * 4)],
    composition: normalizeComposition({
      development: .7 + draw('development') * .3, repetition: .18 + lyric * .54,
      embellishment: .4 + draw('ornaments') * .58, cohesion: .55 + draw('cohesion') * .43,
      accent: .5 + draw('accent') * .49, dynamicRange: .9 + draw('breadth') * .1,
      displacement: .3 + weave * .68, polymeter: .1 + weave * .88,
      transition: .3 + drive * .68,
    }),
  };
  recipe.automation = [];
  delete recipe.automationRevisions;
  Object.assign(recipe, resolveCompositionProfile(recipe));
  const openingNames = { attack: 'Full-force entrance', soliloquy: 'Exposed solo', drive: 'Driving repetition',
    swarm: 'Dense opening argument', air: 'Space before motion', panorama: 'Broad slow entrance' };
  const behavior = formAt(seed, 0, recipe.conductor!).behavior!;
  const description = [openingNames[opening], `prepared ${behavior.strategy.replaceAll('-', ' ')}`,
    lyric > .6 ? 'lyrical' : friction > .55 ? 'chromatic' : 'open harmony', 'native tuning travel'].join(' · ');
  return { recipe, description };
}
