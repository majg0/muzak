import { restAppliesToNote, type PhraseRest } from '../phrasing';
import { PPQ, type NoteEvent, type Parameters } from '../types';
import type { Pitch } from '../pitch';
import { random } from './random';

export interface GlideGestureContext { sourceId: string; startTick: number; endTick: number; }
export interface GlideGesture { start: number; end: number; travel: number; }
interface HeardVoice {
  pitch: Pitch; startPitch: Pitch; startTick: number; glideTicks: number;
  endTick: number; timbre: NoteEvent['timbre']; restAfter?: number;
}

/** A source keeps its manner of connecting the middle of an argument. The
 * window is normalized to the complete thought, so an augmented occurrence
 * carries the same gesture without drawing a fresh lottery for every note. */
export function glideGestureFor(seed: string, sourceId: string): GlideGesture {
  const start = .12 + random(seed, 'glide-gesture-entry', sourceId) * .2;
  return { start, end: Math.min(.92, start + .4 + random(seed, 'glide-gesture-release', sourceId) * .18),
    travel: .24 + random(seed, 'glide-gesture-travel', sourceId) * .3 };
}

/** Physical connections articulate already written destinations. Core notes
 * and coordinated support remain literal. A heard rest closes the gesture;
 * native endpoints and any previously authored pitch curve are retained. */
export class ExpressiveGlides {
  private readonly heard = new Map<number, HeardVoice>();
  private readonly gestures = new Map<string, GlideGesture>();
  constructor(private readonly seed: string) {}

  apply(notes: readonly NoteEvent[], p: Parameters, rests: readonly PhraseRest[], context?: GlideGestureContext): NoteEvent[] {
    return [...notes].sort((a, b) => a.tick - b.tick || a.voice - b.voice).map(original => {
      if (original.part === 'percussion' || !original.absolutePitch) return original;
      const previous = this.heard.get(original.voice);
      let note = original;
      const upper = note.part === 'harmony';
      const melodicLink = note.part === 'melody' && note.voice === 5 && note.expression?.role === 'ornament';
      const protectedNote = note.expression?.role === 'anchor' || note.expression?.role === 'support';
      if (!note.endPitch && previous && (upper || melodicLink) && previous.timbre === note.timbre
        && !protectedNote && note.duration >= (upper ? 480 : 120)) {
        const gap = note.tick - previous.endTick;
        const previousProgress = previous.glideTicks > 0 ? Math.max(0, Math.min(1, (note.tick - previous.startTick) / previous.glideTicks)) : 1;
        const heardPitch = { millicents: Math.round(previous.startPitch.millicents
          + (previous.pitch.millicents - previous.startPitch.millicents) * previousProgress) };
        const distance = Math.abs(note.absolutePitch!.millicents - heardPitch.millicents) / 1000;
        const broken = (previous.restAfter !== undefined && note.tick >= previous.restAfter) || rests.some(rest => restAppliesToNote(note, rest)
          && rest.endTick > previous.endTick && rest.startTick <= note.tick);
        const sourceId = context?.sourceId ?? note.expression?.sourceId ?? `${note.part}:connected-gesture`;
        let gesture = this.gestures.get(sourceId);
        if (!gesture) {
          gesture = glideGestureFor(this.seed, sourceId);
          if (this.gestures.size >= 128) this.gestures.delete(this.gestures.keys().next().value!);
          this.gestures.set(sourceId, gesture);
        }
        const span = context && context.endTick > context.startTick ? context.endTick - context.startTick : PPQ * 8;
        const origin = context?.startTick ?? 0;
        const phase = ((note.tick - origin) % span + span) % span / span;
        const connected = phase >= gesture.start && phase <= gesture.end;
        // Smoothness lengthens a connection; rhythmic density shortens it.
        // Neither parameter selects a different note or rewrites an anchor.
        if (connected && !broken && gap <= (upper ? 120 : 90) && gap >= -PPQ * 2 && distance >= 45
          && distance <= (upper ? 350 : 450)) {
          const fraction = gesture.travel * (.8 + p.voiceLeading * .35) * (1 - p.rhythmicDensity * .22);
          const glideTicks = Math.max(30, Math.min(upper ? 480 : 240, Math.round(note.duration * fraction)));
          note = { ...note, absolutePitch: heardPitch, endPitch: note.absolutePitch, glideTicks,
            articulation: 'connected' };
          delete note.midiNote;
        }
      }
      const endTick = note.tick + note.duration;
      const restAfter = rests.filter(rest => restAppliesToNote(note, rest) && rest.startTick >= endTick)
        .reduce<number | undefined>((earliest, rest) => Math.min(earliest ?? Infinity, rest.startTick), undefined);
      this.heard.set(note.voice, { pitch: note.endPitch ?? note.absolutePitch!, startPitch: note.absolutePitch!,
        startTick: note.tick, glideTicks: note.glideTicks ?? 0, endTick, timbre: note.timbre, restAfter });
      return note;
    });
  }
}
