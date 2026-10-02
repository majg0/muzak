import { callCoreSync } from '../core/sync';
import type { MidiFile } from '../core/generated/MidiFile';
export type { MidiFile } from '../core/generated/MidiFile';
export type { MidiEvent } from '../core/generated/MidiEvent';
export function readMidi(bytes: Uint8Array): MidiFile { return callCoreSync('readMidi', { bytes: Array.from(bytes) }); }
export function writeMidi(file: MidiFile): Uint8Array { return Uint8Array.from(callCoreSync('writeMidi', { file })); }
export function midiPayload(bytes: readonly number[] | Uint8Array): number[] { return callCoreSync('midiPayload', { bytes: Array.from(bytes) }); }
export function midiMeta(type: number, payload: readonly number[]): number[] { return callCoreSync('midiMeta', { kind: type, payload: Array.from(payload) }); }
