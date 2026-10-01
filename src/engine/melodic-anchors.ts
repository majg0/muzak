import type { ThemeCoreSnapshot } from './theme-core';

/** Structural notes retain their sounding time and purpose when harmony
 * listens ahead. A brief approach cannot outvote a long identifying tone.
 * Weights are musical overlap, not physical loudness or sensory roughness. */
export function melodicAnchorsAt(core: ThemeCoreSnapshot | undefined, startTick: number, duration: number): Array<{ cents: number; weight: number }> {
  if (!core || duration <= 0) return [];
  return core.notes.flatMap(note => {
    const overlap = Math.min(note.endTick, startTick + duration) - Math.max(note.startTick, startTick);
    if (overlap <= 0) return [];
    const salience = note.role === 'head' || note.role === 'apex' || note.role === 'cadence' ? 1.4 : 1;
    return [{ cents: note.absolutePitchCents, weight: Math.round(overlap * salience / 480 * 1000) / 1000 }];
  });
}
