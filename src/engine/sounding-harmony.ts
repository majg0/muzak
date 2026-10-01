import type { Pitch } from '../pitch';
import { restAppliesToNote, type PhraseRest } from '../phrasing';
import type { NoteEvent } from '../types';
import { clipGainEnvelope, notePitchAt } from '../note-expression';

export interface HarmonicContext { voices: Pitch[]; bass: Pitch; }

/** The audible harmonic bed, independent of the planner's next sonority.
 * Retain at most one tail per part/voice. A later attack supersedes an older
 * hold even after that later note ends; an old note must never resurrect. */
export class SoundingScore {
  private tails: NoteEvent[] = [];

  /** Project physical lines, including sustained foreground and orchestral
   * parts. A replacement or rest ends a source permanently, even when the
   * replacement is shorter. Future onsets never become present evidence. */
  events(onsets: readonly NoteEvent[], rests: readonly PhraseRest[]): NoteEvent[] {
    return structuredClone(this.project(onsets, rests));
  }

  private project(onsets: readonly NoteEvent[], rests: readonly PhraseRest[]): NoteEvent[] {
    const events = [...this.tails, ...onsets.filter(note => note.absolutePitch)]
      .sort((a, b) => a.tick - b.tick || a.voice - b.voice || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const next = new Map<string, number>(), output: NoteEvent[] = [];
    for (let index = events.length - 1; index >= 0; index--) {
      const note = events[index], key = `${note.part}:${note.voice}`;
      let end = Math.min(note.tick + note.duration, next.get(key) ?? Infinity);
      next.set(key, note.tick);
      for (const rest of rests) if (restAppliesToNote(note, rest) && rest.endTick > note.tick && rest.startTick < end)
        end = Math.min(end, Math.max(note.tick, rest.startTick));
      if (end > note.tick) output.push({ ...note, duration: end - note.tick,
        // Clipping a sounding window cannot accelerate an implicit glide.
        ...(note.endPitch ? { glideTicks: Number.isFinite(note.glideTicks) ? note.glideTicks : note.duration } : {}),
        ...(note.gainEnvelope && end < note.tick + note.duration ? { gainEnvelope: clipGainEnvelope(note.gainEnvelope, end - note.tick) } : {}) });
    }
    return output.reverse();
  }

  commit(notes: readonly NoteEvent[], rests: readonly PhraseRest[], endTick: number): void {
    // Only the bounded retained tail set becomes state. Neither the caller's
    // frame nor a returned projection may mutate the sounding history.
    this.tails = structuredClone(this.project(notes, rests).filter(note => note.tick < endTick && note.tick + note.duration > endTick));
  }
}

/** Harmonic support is one projection of the same sounding score used by
 * counterpoint. Planned fallback identities remain explicit at this adapter. */
export class SoundingHarmony extends SoundingScore {
  at(onsets: readonly NoteEvent[], rests: readonly PhraseRest[], fallback: HarmonicContext): (tick: number) => HarmonicContext {
    const events = this.events(onsets, rests);
    return tick => {
      const sounding = events.filter(note => note.tick <= tick && note.tick + note.duration > tick);
      const pitchAt = (note: NoteEvent): Pitch => notePitchAt(note, tick)!;
      const voices = sounding.filter(note => note.part === 'harmony').sort((a, b) => a.voice - b.voice).map(pitchAt);
      const bass = sounding.find(note => note.part === 'bass');
      return { voices: voices.length ? voices : fallback.voices, bass: bass ? pitchAt(bass) : fallback.bass };
    };
  }

}
