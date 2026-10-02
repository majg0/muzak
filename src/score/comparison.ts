import { callCoreSync } from '../core/sync';
import type { Score } from './score';
import type { ScoreComparisonOptions } from '../core/generated/ScoreComparisonOptions';
export type { ScoreComparison } from '../core/generated/ScoreComparison';
export type { ScoreComparisonOptions } from '../core/generated/ScoreComparisonOptions';
export function compareScores(a: Score, b: Score, options: ScoreComparisonOptions = {}) { return callCoreSync('compareScores', {a, b, options}); }
