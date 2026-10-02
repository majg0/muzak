import { callCoreSync } from '../core/sync';
import type { ScoreNote } from './score';
export const pitchAt = (note: ScoreNote, offset: number): number => callCoreSync('pitchAt', { note, offset });
export const gainAt = (note: ScoreNote, offset: number): number => callCoreSync('gainAt', { note, offset });
export const transposeNote = (note: ScoreNote, millicents: number): ScoreNote => callCoreSync('transposeNote', { note, millicents });
export const noteTimes = (note: ScoreNote): number[] => callCoreSync('noteTimes', { note });
export const cropNoteTrajectories = (note: ScoreNote, offset: number, duration: number) => callCoreSync('cropNoteTrajectories', { note, offset, duration });
