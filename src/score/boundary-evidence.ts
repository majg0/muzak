import { callCoreSync } from '../core/sync';
import type { Score } from './score';
import type { BoundarySelection } from '../core/generated/BoundarySelection';
import type { BoundaryEvidenceOptions } from '../core/generated/BoundaryEvidenceOptions';
export type { BoundarySelection };
export type { BoundaryEvidence } from '../core/generated/BoundaryEvidence';
export type { BoundaryCaps } from '../core/generated/BoundaryCaps';
export type { BoundaryCue } from '../core/generated/BoundaryCue';
export type { BoundaryGap } from '../core/generated/BoundaryGap';
export type { BoundaryIssue } from '../core/generated/BoundaryIssue';
/** Refined LBDM observations with explicit strict monophony and endpoint
 * conventions. The Rust result exposes separate cues, not phrase labels. */
export const boundaryEvidence = (score: Score, selection: BoundarySelection, options: BoundaryEvidenceOptions = {}) => callCoreSync('boundaryEvidence', { score, selection, options });
