import { callCoreSync } from '../core/sync';
import type { BoundaryOptions as CoreBoundaryOptions } from '../core/generated/BoundaryOptions';
import type { BoundaryReference } from '../core/generated/BoundaryReference';
import type { Occurrence } from '../core/generated/Occurrence';
import type { OccurrenceReference } from '../core/generated/OccurrenceReference';
export type { BoundaryReference, Occurrence, OccurrenceReference };
export type BoundaryOptions = Omit<CoreBoundaryOptions, 'span'> & { span: readonly [number, number] };
export type PrecisionRecall = Pick<import('../core/generated/BoundaryEvaluation').BoundaryEvaluation, 'precision' | 'recall' | 'f1'>;
export type { BoundaryEvaluation } from '../core/generated/BoundaryEvaluation';
export type { OccurrenceEvaluation } from '../core/generated/OccurrenceEvaluation';
/** Exact assignment limit enforced in Rust; exported for benchmark admission. */
export const MAX_OCCURRENCES = 512;
/** References stay separate. Empty denominators give P/R=1 respectively;
 * one-sided empty F1=0; both-empty F1=1. Units/endpoints are caller-declared. */
export const evaluateBoundaries = (estimated: readonly number[], references: readonly BoundaryReference[], options: BoundaryOptions) => callCoreSync('evaluateBoundaries', { estimated: [...estimated], references: [...references], options: { ...options, span: [...options.span] } });
/** Generic maximum shared-membership assignment, NOT MIREX establishment or
 * occurrence metrics. No transposition/alignment, salience or quality claim. */
export const evaluateOccurrences = (estimated: readonly Occurrence[], references: readonly OccurrenceReference[]) => callCoreSync('evaluateOccurrences', { estimated: [...estimated], references: [...references] });
