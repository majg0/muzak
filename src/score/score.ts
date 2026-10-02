import { callCoreSync } from '../core/sync';
import type { Score } from '../core/generated/Score';
import type { ScoreNote } from '../core/generated/ScoreNote';
export type { Score } from '../core/generated/Score';
export type { ScoreNote } from '../core/generated/ScoreNote';
export type { ScorePart } from '../core/generated/ScorePart';
export type { ScoreIssue } from '../core/generated/ScoreIssue';
export type { ScoreAttachment } from '../core/generated/ScoreAttachment';
export type { PitchEnvelopePoint } from '../core/generated/PitchEnvelopePoint';
export type { GainEnvelopePoint } from '../core/generated/GainEnvelopePoint';
export function validateScore(score: Score): void { callCoreSync('validateScore', { score }); }
export function validateNoteTrajectories(note: ScoreNote): void { callCoreSync('validateNoteTrajectories', { note }); }
