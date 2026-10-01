import { gainEnvelopeAt } from '../note-expression';
import { PPQ, type NoteEvent, type OrchestrationDiagnostics } from '../types';
import { restAppliesToNote, type PhraseRest } from '../phrasing';

const round = (n: number) => Math.round(n * 1e6) / 1e6;
const voiceKey = (n: NoteEvent) => `${n.part}:${n.voice}${n.part === 'percussion' ? ':' + n.midiNote : ''}`;
/** Observe a short committed-score window. This does not influence composition
 * and does not infer listener tension or audio loudness from note counts.
 * Pitched same-voice attacks replace their prior written hold; FX are excluded. */
export class OrchestrationObserver {
  private recent: NoteEvent[] = [];
  measure(notes: readonly NoteEvent[], tick: number, duration: number, requestedEnergy: number, rests: readonly PhraseRest[] = []): OrchestrationDiagnostics {
    const end = tick + duration, start = Math.max(0, end - PPQ * 4);
    for (const note of [...notes].sort((a, b) => a.tick - b.tick || a.voice - b.voice)) {
      for (const previous of this.recent) if (voiceKey(previous) === voiceKey(note) && previous.tick < note.tick
        && previous.tick + previous.duration > note.tick) previous.duration = note.tick - previous.tick;
      this.recent.push({ ...note });
    }
    for (const note of this.recent) for (const rest of rests) if (restAppliesToNote(note, rest)
      && note.tick < rest.endTick && note.tick + note.duration > rest.startTick) {
      note.duration = Math.max(0, rest.startTick - note.tick);
    }
    this.recent = this.recent.filter(note => note.tick + note.duration > start && note.tick < end)
      .sort((a, b) => a.tick - b.tick || a.voice - b.voice || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const attacks = this.recent.filter(note => note.tick >= start);
    let maxVoices = 0, energy = 0, samples = 0;
    for (let at = start; at < end; at += PPQ / 8) {
      const active = new Map<string, NoteEvent>();
      for (const note of this.recent) {
        if (note.tick > at) break;
        active.set(voiceKey(note), note);
      }
      const sounding = [...active.values()].filter(note => note.tick + note.duration > at);
      maxVoices = Math.max(maxVoices, sounding.length);
      energy += sounding.reduce((sum, note) => sum + (note.velocity * gainEnvelopeAt(note.gainEnvelope, at - note.tick)) ** 2, 0);
      samples++;
    }
    return { requestedEnergy: round(Math.max(0, Math.min(1, requestedEnergy))),
      attacksPerBeat: round(attacks.length * PPQ / Math.max(1, end - start)), activeVoices: maxVoices,
      meanVelocity: round(attacks.reduce((sum, note) => sum + note.velocity, 0) / Math.max(1, attacks.length)),
      heldGainProxy: round(energy / Math.max(1, samples)) };
  }
}
