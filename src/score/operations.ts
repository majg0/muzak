import { callCoreSync } from '../core/sync';
import type { Score } from './score';
import type { ScoreSelection as WireSelection } from '../core/generated/ScoreSelection';
import type { SliceOptions } from '../core/generated/SliceOptions';
export type ScoreSelection = Partial<{ [K in keyof WireSelection]: Readonly<NonNullable<WireSelection[K]>> }>;
export function selectNotes(score: Score, selection: ScoreSelection = {}) { return callCoreSync('selectNotes', { score, selection: selection as WireSelection }); }
export function sliceScore(score: Score, start: number, end: number, options: Omit<SliceOptions, 'selection'> & { selection?: ScoreSelection }) {
  return callCoreSync('sliceScore', { score, start, end, options: { ...options, selection: options.selection as WireSelection ?? {} } });
}
export function transposeScore(score: Score, millicents: number, selection: ScoreSelection = {}) { return callCoreSync('transposeScore', { score, millicents, selection: selection as WireSelection }); }
export function stretchScore(score: Score, numerator: number, denominator: number) { return callCoreSync('stretchScore', { score, numerator, denominator }); }
