import { DEFAULT_COMPOSITION } from './composition';
import { DEFAULT_CONDUCTOR } from './conductor';
import { DEFAULT_HARMONY, type HarmonyConfig } from './harmonic-language';
import { DEFAULT_PHRASING } from './phrasing';
import { normalizeParameters } from './parameters';
import { newSeedPerformance } from './sessions';
import type { TuningId } from './pitch';
import type { Parameters, Performance } from './types';

/** Auditionable hypotheses, not artist classifiers. Every study uses the same
 * composer and is just an editable, serializable parameter/configuration vector. */
export const COMPOSITION_STUDIES = [
  { id: 'floating-lines', name: 'Floating lines', intent: 'Connected, spacious lines over mobile harmony; space between bursts.',
    parameters: { ideaDensity: .38, ensembleSize: .45, voiceLeading: .99, harmonicMobility: .76, harmonicSurprise: .46,
      tonalClarity: .54, dissonance: .16, rhythmicComplexity: .12, rhythmicPredictability: .92, metricStability: .96,
      melodicActivity: .38, motifRecurrence: .52, motifTransformation: .5, dynamics: .52 },
    harmony: { strategy: 'tonnetz', functionalMotion: .42, harmonicColor: .55, cadenceStrength: .24, treatment: 'develop' },
    freedom: .54, pace: .3, breadth: .48, ornaments: .3, polymeter: .12, tuning: '19edo' },
  { id: 'developing-solo', name: 'Developing solo', intent: 'Short statements, held targets, connected runs and ornaments over a steadier harmonic frame.',
    parameters: { ideaDensity: .72, ensembleSize: .38, voiceLeading: .94, harmonicMobility: .36, harmonicSurprise: .32,
      tonalClarity: .84, dissonance: .12, rhythmicComplexity: .3, rhythmicPredictability: .84, metricStability: .94,
      melodicActivity: .7, motifRecurrence: .36, motifTransformation: .72, dynamics: .64 },
    harmony: { strategy: 'functional', functionalMotion: .1, harmonicColor: .32, cadenceStrength: .46, treatment: 'develop' },
    freedom: .53, pace: .32, breadth: .5, ornaments: .78, polymeter: .15, tuning: '12tet' },
  { id: 'interlocking-drive', name: 'Interlocking drive', intent: 'A stable audible pulse, introduced cross-riffs, ensemble accents and varied fast development.',
    parameters: { ideaDensity: .88, ensembleSize: .85, voiceLeading: .92, harmonicMobility: .65, harmonicSurprise: .44,
      tonalClarity: .76, dissonance: .18, rhythmicComplexity: .76, rhythmicPredictability: .84, metricStability: .95,
      rhythmicDensity: .8, melodicActivity: .82, motifRecurrence: .5, motifTransformation: .62, dynamics: .8 },
    harmony: { strategy: 'balanced', functionalMotion: .55, harmonicColor: .45, cadenceStrength: .48, treatment: 'develop' },
    freedom: .7, pace: .32, breadth: .72, ornaments: .4, polymeter: .75, tuning: '12tet' },
  { id: 'travelling-theme', name: 'Travelling theme', intent: 'A remembered core moves to new regions; longer journeys can end in a handoff rather than home.',
    parameters: { ideaDensity: .35, ensembleSize: .75, voiceLeading: .96, harmonicMobility: .7, harmonicSurprise: .54,
      tonalClarity: .84, dissonance: .1, rhythmicComplexity: .12, rhythmicPredictability: .94, metricStability: .96,
      melodicActivity: .4, motifRecurrence: .72, motifTransformation: .45, dynamics: .65 },
    harmony: { strategy: 'third-cycle', functionalMotion: .35, harmonicColor: .56, cadenceStrength: .4, treatment: 'sequence' },
    freedom: .6, pace: .22, breadth: .7, ornaments: .24, polymeter: .1, tuning: '12tet' },
  { id: 'quartertone-prism', name: 'Quarter-tone prism', intent: 'Native 24-EDO wide/narrow third colors, fine neighbor ornaments and complementary lines.',
    parameters: { ideaDensity: .58, ensembleSize: .62, voiceLeading: .96, harmonicMobility: .62, harmonicSurprise: .62,
      tonalClarity: .66, dissonance: .2, rhythmicComplexity: .24, rhythmicPredictability: .86, metricStability: .9,
      chromaticism: .4, melodicActivity: .52, motifRecurrence: .48, motifTransformation: .64, dynamics: .62 },
    harmony: { strategy: 'tonnetz', functionalMotion: .35, harmonicColor: .6, cadenceStrength: .3, treatment: 'develop' },
    freedom: .6, pace: .25, breadth: .58, ornaments: .56, polymeter: .28, tuning: '24edo' },
  { id: 'fine-gravity', name: 'Fine gravity', intent: 'Native 31-EDO thirds, smooth chromatic connections and a slowly widening ensemble.',
    parameters: { ideaDensity: .48, ensembleSize: .74, voiceLeading: .99, harmonicMobility: .72, harmonicSurprise: .45,
      tonalClarity: .86, dissonance: .12, rhythmicComplexity: .18, rhythmicPredictability: .92, metricStability: .94,
      chromaticism: .35, melodicActivity: .42, motifRecurrence: .68, motifTransformation: .44, dynamics: .65 },
    harmony: { strategy: 'balanced', functionalMotion: .35, harmonicColor: .5, cadenceStrength: .55, treatment: 'sequence' },
    freedom: .58, pace: .22, breadth: .64, ornaments: .42, polymeter: .18, tuning: '31edo' },
] satisfies Array<{ id: string; name: string; intent: string; parameters: Partial<Parameters>; harmony: HarmonyConfig;
  freedom: number; pace: number; breadth: number; ornaments: number; polymeter: number; tuning: TuningId }>;

export function compositionStudy(source: Performance, id: string): Performance {
  const study = COMPOSITION_STUDIES.find(item => item.id === id);
  if (!study) throw new Error('Unknown composition study.');
  const recipe = newSeedPerformance(source, source.seed);
  recipe.presetId = study.id;
  recipe.initialParameters = normalizeParameters({ ...source.initialParameters, ...study.parameters });
  recipe.sound = { ...recipe.sound, tuning: study.tuning, instrument: 'ensemble', roughnessWeight: 0 };
  recipe.conductor = { ...DEFAULT_CONDUCTOR, amount: study.freedom, pace: study.pace, tuningTravel: false };
  recipe.phrasing = { ...DEFAULT_PHRASING, harmony: { ...DEFAULT_HARMONY, ...study.harmony },
    syncopation: study.parameters.rhythmicComplexity! * .35, variation: study.ornaments,
    composition: { ...DEFAULT_COMPOSITION, dynamicRange: study.breadth, embellishment: study.ornaments,
      polymeter: study.polymeter, displacement: study.polymeter * .5, cohesion: .85 } };
  return recipe;
}
