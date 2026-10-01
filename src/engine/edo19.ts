/** Backward-compatible named adapter for the original bounded experiment.
 * The production planner now shares physical constraints across native EDOs. */
import { nativeClass, nativeSpace, validNativeVoices } from './native-space';
import { initialNativeState, nativeFieldFit, planNativeEdo, type NativeEdoState, type NativeEdoCandidate } from './native-edo';
import type { Parameters, ScoreWeights } from '../types';
import type { RoughnessScorer } from './roughness-scoring';
import type { PlanningIntent } from './intent';
export type Edo19State = NativeEdoState;
export type Edo19Candidate = NativeEdoCandidate;
export const EDO19_VOICE_RANGES = nativeSpace('19edo').voices;
export const EDO19_BASS_RANGE = nativeSpace('19edo').bass;
export const mod19 = (n: number) => nativeClass(n, '19edo');
export const edo19Collection = (degrees: number[]) => degrees.reduce((mask, n) => mask | (1 << mod19(n)), 0);
export const validEdo19Voices = (degrees: number[]) => validNativeVoices(degrees, '19edo');
export const initialEdo19State = (seed: string) => initialNativeState(seed, '19edo');
export const edo19FieldFit = (upper: number[], bass: number, center: number) => nativeFieldFit(upper, bass, center, '19edo');
export function planEdo19(seed: string, state: Edo19State, parametersAt: (index: number) => Parameters,
  weights: ScoreWeights, sensory: RoughnessScorer, intentAt?: (index: number, p: Parameters) => PlanningIntent) {
  return planNativeEdo('19edo', seed, state, parametersAt, weights, sensory, intentAt && ((index, p) => {
    const intent = intentAt(index, p);
    return { ...intent, centerDegreeNative: intent.centerDegreeNative ?? intent.centerDegree19 };
  }));
}
