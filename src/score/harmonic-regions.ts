import { callCoreSync } from '../core/sync';
import type { Score } from './score';
import type { ScoreSelection } from './operations';
import type { HarmonicRegionOptions } from '../core/generated/HarmonicRegionOptions';
export type { HarmonicRegionOptions };
export type { HarmonicRegionAnalysis } from '../core/generated/HarmonicRegionAnalysis';
export type { HarmonicHeldRun } from '../core/generated/HarmonicHeldRun';
export type { SupportCohort } from '../core/generated/SupportCohort';
export type { HarmonicSupportFamily } from '../core/generated/HarmonicSupportFamily';
export type { HarmonicRun } from '../core/generated/HarmonicRun';
export type { HarmonicMelodyCell } from '../core/generated/HarmonicMelodyCell';
/** Bounded support/complement hypotheses, with explicit accompaniment priors
 * and exact source memberships. No chord/function or independent voice claim. */
export const inferHarmonicRegions = (score: Score, selection: ScoreSelection, options: HarmonicRegionOptions = {}) => callCoreSync('inferHarmonicRegions', { score, selection: { ...selection, parts: selection.parts ? [...selection.parts] : undefined, pitchRange: selection.pitchRange ? [...selection.pitchRange] : undefined }, options });
