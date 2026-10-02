import { callCoreSync } from '../core/sync';
import type { Score } from './score';
export function importMidi(bytes: Uint8Array) { return callCoreSync('importMidi', { bytes: Array.from(bytes) }); }
export function exportScoreMidi(score: Score): Uint8Array { return Uint8Array.from(callCoreSync('exportScoreMidi', { score })); }
