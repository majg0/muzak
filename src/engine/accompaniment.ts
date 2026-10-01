import type { FormState } from '../conductor';
import type { StructuralCue } from '../composition';
import { restAppliesToNote, type PhraseRest } from '../phrasing';
import { PPQ, type NoteEvent, type Parameters } from '../types';
import type { ExpressiveContour } from './expression';
import { textureIntentAt, texturePulseAt, type TextureAt } from './texture';
import { lyricalHarmonyWindow, type LyricalHarmonyWindow } from './lyrical-support';
import { DEFAULT_HARMONY, type HarmonyConfig } from '../harmonic-language';
import { withRhythmicScore, type ScoredTextureAt } from './rhythmic-score';
import type { TuningId } from '../pitch';

export interface AccompanimentContext {
  seed: string;
  tick: number;
  duration: number;
  form: FormState;
  parameters: Parameters;
  expressiveAt: (tick: number) => ExpressiveContour;
  textureAt?: TextureAt;
  harmony?: HarmonyConfig;
  /** The committed thought owns its destination clock, including a final
   * partial window. Section bars remain the standalone adapter's default. */
  harmonySpan?: LyricalHarmonyWindow;
  bassTemplate?: NoteEvent;
  tuning?: TuningId;
  additive: boolean;
  solo?: boolean | ((tick: number) => boolean);
  cues?: readonly StructuralCue[];
  rests?: readonly PhraseRest[];
}

const clamp = (value: number, low = 0, high = 1) => Math.max(low, Math.min(high, value));
const rounded = (value: number) => Math.round(value * 1e6) / 1e6;
type ScoredAccompaniment = Omit<AccompanimentContext, 'harmony' | 'textureAt'> & { harmony: HarmonyConfig; textureAt: ScoredTextureAt };

/** Interpret the chosen pitches through the shared rhythmic score. Standalone
 * callers adapt their expression once; all deliveries follow the same path. */
export function realizeAccompaniment(notes: NoteEvent[], context: AccompanimentContext): NoteEvent[] {
  const { seed, tick, duration, form, parameters, expressiveAt } = context;
  if (![tick, duration, tick + duration].every(Number.isSafeInteger) || tick < 0 || duration <= 0)
    throw new RangeError('Accompaniment needs an integer musical frame.');
  if (!notes.some(note => note.part === 'harmony')) return notes;
  const formAt = (at: number): FormState => ({ ...form,
    barStartTick: form.sectionStartTick + Math.floor((at - form.sectionStartTick) / form.barTicks) * form.barTicks });
  const supplied = context.textureAt ?? (at => textureIntentAt(parameters, formAt(at), expressiveAt(at)));
  return realizeComposedBed(notes, { ...context, harmony: context.harmony ?? DEFAULT_HARMONY,
    textureAt: withRhythmicScore(seed, formAt, parameters, supplied) });
}

/** The composition owns harmonic identity; expression chooses its delivery.
 * Every attack uses the current sounding destination's actual registered
 * pitches. Holds finish at the next destination, so a previous chord cannot
 * survive underneath a new one simply because its gesture clock was longer.
 * The native additive path shares timing, but never changes its fixed gains. */
function realizeComposedBed(notes: NoteEvent[], context: ScoredAccompaniment): NoteEvent[] {
  const { tick, duration, form, seed } = context;
  const templates = notes.filter(note => note.part === 'harmony');
  const output = notes.filter(note => note.part !== 'harmony');
  const endTick = context.harmonySpan?.endTick ?? form.sectionEndTick;
  const rests = context.rests ?? [], until = Math.min(tick + duration, endTick);
  if (context.additive) {
    // The sensory experiment compares a simultaneous five-tone reference
    // sonority with its actual partial amplitudes. Its instrumental adapter
    // therefore holds that bed even when the score requests fast figures.
    const window = lyricalHarmonyWindow({ ...form, barStartTick: tick }, context.harmony, context.harmonySpan);
    const held = realizeLyricalBed(notes, context).map(note => note.part === 'bass' && note.endPitch
      ? { ...note, duration: window.endTick - note.tick } : note);
    return realizeComposedBass(held, templates, { ...context,
      textureAt: at => ({ ...context.textureAt!(at), pace: 0 }) }).sort((a, b) => a.tick - b.tick || a.voice - b.voice);
  }
  if (templates.some(note => note.endPitch || note.glideTicks)) return realizeLyricalBed(notes, context);
  const first = lyricalHarmonyWindow(form, context.harmony, context.harmonySpan), span = first.endTick - first.startTick;
  for (let start = first.startTick; start < until; start += span) {
    const end = Math.min(start + span, endTick);
    const attacks = new Map<string, { at: number; voice: number; texture: ReturnType<ScoredTextureAt> }>();
    const add = (at: number, voice: number, texture: ReturnType<ScoredTextureAt>) => {
      const template = templates.find(note => note.voice === voice);
      if (template && !rests.some(rest => restAppliesToNote(template, rest) && at >= rest.startTick && at < rest.endTick)) attacks.set(`${at}:${voice}`, { at, voice, texture });
    };
    for (let at = start; at < end; at += PPQ / 8) {
      const texture = context.textureAt(at);
      if (at === start) { for (const template of templates) add(at, template.voice, texture); continue; }
      if (texture.pace < .3) {
        // Re-enter a held destination after an authored rest, on its first
        // available beat, rather than leaving it empty until the next chord.
        if (at % PPQ === 0) for (const template of templates) if (rests.some(rest => restAppliesToNote(template, rest)
          && rest.endTick > at - PPQ && rest.endTick <= at)) add(at, template.voice, texture);
        continue;
      }
      if (texture.pace < .65) {
        // The medium register is a sparse interpretation of the same riff,
        // not a separate quarter-note arpeggio fighting its syncopation.
        if (texturePulseAt(seed, at, texture) > 0) {
          const hit = texture.rhythm.accents.find(note => note.tick === at);
          add(at, ((hit?.group ?? 0) + texture.rhythm.iteration) % 4, texture);
        }
        continue;
      }
      const pulse = texturePulseAt(seed, at, texture);
      if (!pulse) continue;
      const rhythm = texture.rhythm, hit = rhythm.accents.find(note => note.tick === at);
      const group = hit?.group ?? 0;
      const groupStart = rhythm.cycleStartTick + rhythm.cell[group].offsetTicks;
      const local = rhythm.accents.filter(note => note.tick >= groupStart && note.tick <= at).length - 1;
      const voice = (group + Math.max(0, local) + rhythm.iteration) % 4;
      add(at, voice, texture);
      if ((hit?.level === 'goal' || pulse === 1) && texture.pace > .82)
        add(at, (voice + 2) % 4, texture);
    }
    const ordered = [...attacks.values()].sort((a, b) => a.at - b.at || a.voice - b.voice);
    for (const attack of ordered) {
      if (attack.at < tick || attack.at >= until) continue;
      const template = templates.find(note => note.voice === attack.voice)!;
      const next = ordered.find(other => other.voice === attack.voice && other.at > attack.at)?.at ?? end;
      const texture = attack.texture;
      let ending = texture.pace < .3 ? next : Math.min(next,
        attack.at + Math.round((texture.pace < .65 ? PPQ * 1.6 : texture.subdivisionTicks) * texture.gateRatio));
      for (const rest of rests) if (restAppliesToNote(template, rest) && rest.startTick > attack.at) ending = Math.min(ending, rest.startTick);
      const length = ending - attack.at;
      if (length <= 0) continue;
      const offsets = [...new Set([0, Math.round(length * .3), Math.round(length * .7), length])];
      const solo = typeof context.solo === 'function' ? context.solo(attack.at) : Boolean(context.solo);
      const sourceAccent = texture.rhythm.accents.find(note => note.tick === attack.at)?.strength;
      output.push({ ...template, id: `composed-bed:${start}:${attack.at}:${attack.voice}`, tick: attack.at, duration: length,
        ...(context.additive ? {} : {
          velocity: rounded(clamp(template.velocity * (solo ? .73 : .92) * (sourceAccent === undefined || texture.pace < .3 ? 1 : .7 + sourceAccent * .3))),
          articulation: texture.articulation,
          ...(texture.pace < .3 ? { timbre: 'strings' as const } : {}),
          gainEnvelope: offsets.map(offset => {
            // A held harmony is breathed as one musical gesture. Its local
            // bow swell sits inside the common long-form intensity; it does
            // not restart on each planner frame or add another phrase clock.
            const progress = clamp((attack.at + offset - start) / Math.max(1, end - start));
            const breath = texture.pace < .3 ? .82 + .18 * Math.sin(Math.PI * progress) : 1;
            return { tick: offset, gain: rounded((.8 + context.expressiveAt(attack.at + offset).intensity * .19) * breath) };
          }),
        }),
        expression: { role: 'layer', sourceId: texture.rhythm.sourceId } });
    }
  }
  return realizeComposedBass(output, templates, context).sort((a, b) => a.tick - b.tick || a.voice - b.voice);
}

function realizeComposedBass(notes: NoteEvent[], upper: NoteEvent[], context: AccompanimentContext): NoteEvent[] {
  const template = context.bassTemplate;
  if (!template?.absolutePitch || template.endPitch || notes.some(note => note.part === 'bass' && note.endPitch)) return notes;
  const { tick, duration, form } = context, root = template.absolutePitch.millicents;
  const textureAt = context.textureAt!, rests = context.rests ?? [];
  const endTick = context.harmonySpan?.endTick ?? form.sectionEndTick;
  const window = lyricalHarmonyWindow(form, context.harmony, context.harmonySpan), span = window.endTick - window.startTick;
  const startAt = (at: number) => window.startTick + Math.floor((at - window.startTick) / span) * span;
  const endAt = (at: number) => Math.min(startAt(at) + span, endTick);
  const native = context.tuning !== undefined && context.tuning !== '12tet';
  const minimum = 2800000;
  const maximum = Math.min(5200000, Math.min(...upper.map(note => note.absolutePitch!.millicents)) - 700000);
  const candidates = new Set<number>();
  for (const pitch of [root, ...upper.map(note => note.absolutePitch!.millicents)]) {
    for (let shift = -6; shift <= 3; shift++) {
      const placed = pitch + shift * 1200000;
      if (placed >= minimum && placed <= maximum + 1) candidates.add(placed);
    }
  }
  const allowed = [...candidates];
  const result = notes.filter(note => note.part !== 'bass' || textureAt(note.tick).pace >= .3).map(note => {
    if (note.part !== 'bass' || !note.absolutePitch) return note;
    const atBoundary = note.tick === startAt(note.tick);
    const pitch = atBoundary || !allowed.length ? root : allowed.slice().sort((a, b) => Math.abs(a - note.absolutePitch!.millicents) - Math.abs(b - note.absolutePitch!.millicents) || a - b)[0];
    const converted = { ...note, absolutePitch: { millicents: pitch }, duration: Math.min(note.duration, endAt(note.tick) - note.tick) };
    if (native) delete converted.midiNote;
    else converted.midiNote = pitch / 100000;
    return converted;
  });
  for (let at = Math.max(window.startTick, Math.ceil((tick - window.startTick) / span) * span + window.startTick); at < tick + duration && at < endTick; at += span) {
    if (rests.some(rest => restAppliesToNote(template, rest) && at >= rest.startTick && at < rest.endTick)) continue;
    const texture = textureAt(at);
    if (result.some(note => note.part === 'bass' && note.tick === at)) continue;
    let end = texture.pace < .3 ? endAt(at) : Math.min(endAt(at), at + Math.round(PPQ * texture.gateRatio));
    for (const rest of rests) if (restAppliesToNote(template, rest) && rest.startTick > at) end = Math.min(end, rest.startTick);
    const next = result.find(note => note.part === 'bass' && note.tick > at)?.tick;
    if (next !== undefined) end = Math.min(end, next);
    if (end <= at) continue;
    result.push({ ...template, id: `composed-bass:${at}`, tick: at, duration: end - at,
      ...(context.additive ? {} : { articulation: texture.articulation, velocity: rounded(template.velocity * .94) }),
      expression: { role: 'support', sourceId: `composed-harmony:${form.themeId}:${at}` } });
  }
  return result;
}

function realizeLyricalBed(notes: NoteEvent[], context: AccompanimentContext): NoteEvent[] {
  const { tick, duration, form } = context;
  const endTick = context.harmonySpan?.endTick ?? form.sectionEndTick;
  const window = lyricalHarmonyWindow(form, context.harmony, context.harmonySpan), span = window.endTick - window.startTick;
  const output = notes.filter(note => note.part !== 'harmony');
  const templates = notes.filter(note => note.part === 'harmony');
  const rests = context.rests ?? [];
  for (let at = window.startTick; at < Math.min(tick + duration, endTick); at += span) {
    if (at < tick) continue;
    for (const template of templates) {
      if (rests.some(rest => restAppliesToNote(template, rest) && at >= rest.startTick && at < rest.endTick)) continue;
      let end = Math.min(at + span, endTick);
      for (const rest of rests) if (restAppliesToNote(template, rest) && rest.startTick > at) end = Math.min(end, rest.startTick);
      const length = end - at;
      if (length <= 0) continue;
      const offsets = [...new Set([0, Math.round(length / 3), Math.round(length * 2 / 3), length])];
      output.push({ ...template, id: `lyrical-bed:${at}:${template.voice}`, tick: at, duration: length,
        ...(context.additive ? {} : { velocity: rounded(clamp(template.velocity * .95)), articulation: 'sustained' as const, timbre: 'strings' as const,
          gainEnvelope: offsets.map(offset => ({ tick: offset, gain: rounded(.78 + context.expressiveAt(at + offset).intensity * .2) })) }),
        expression: { role: 'layer', sourceId: `lyrical-harmony:${at}` } });
    }
  }
  return output.sort((a, b) => a.tick - b.tick || a.voice - b.voice);
}
