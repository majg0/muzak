import { degreeToPitch, pitchToDegree, pitchToMidi, TUNINGS, type Pitch, type TuningId } from '../pitch';
import { restAppliesToNote, type PhraseRest } from '../phrasing';
import { clipGainEnvelope } from '../note-expression';
import { PPQ, type NoteEvent, type Parameters } from '../types';
import type { TransitionPlan } from './transitions';
import type { TextureAt } from './texture';
import { chordalBassPitch } from './groove';

export interface EnsembleFillSnapshot {
  id: string; boundaryTick: number; startTick: number; endTick: number;
  shape: string;
  energy: number; parts: NoteEvent['part'][]; sharedTicks: number[];
}
export interface EnsembleFillContext {
  seed: string; tick: number; duration: number; plans: readonly TransitionPlan[];
  parameters: Parameters; tuning: TuningId; additive: boolean;
  templates?: readonly NoteEvent[]; bassTemplate?: NoteEvent; rests?: readonly PhraseRest[];
  previousVoiceEnds?: ReadonlyMap<number, number>; cohesion?: number;
  textureAt?: TextureAt;
}
export interface EnsembleFillResult { notes: NoteEvent[]; rests: PhraseRest[]; fills: EnsembleFillSnapshot[]; }
const clamp = (value: number, low = 0, high = 1) => Math.max(low, Math.min(high, value));
const round = (value: number) => Math.round(value * 1e6) / 1e6;
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const instrument = (a: NoteEvent, b: NoteEvent) => a.part === b.part && a.voice === b.voice && (a.part !== 'percussion' || a.midiNote === b.midiNote);

function shortened(note: NoteEvent, end: number): NoteEvent | undefined {
  const duration = Math.min(note.duration, end - note.tick);
  if (duration <= 0) return undefined;
  if (duration === note.duration) return note;
  const result = { ...note, duration };
  if (note.gainEnvelope) result.gainEnvelope = clipGainEnvelope(note.gainEnvelope, duration);
  if (note.endPitch && note.absolutePitch && note.glideTicks && duration < note.glideTicks) {
    result.endPitch = { millicents: Math.round(note.absolutePitch.millicents + (note.endPitch.millicents - note.absolutePitch.millicents) * duration / note.glideTicks) };
    result.glideTicks = duration;
  }
  return result;
}

/** Orchestrate an already announced fill, not every accompaniment pulse.
 * Drums keep their written preparation; bass approaches, upper pairs answer,
 * and a free counter voice carries the final pickup. Shared accents gather
 * these roles into an arrival without making their complete rhythms unison.
 * No future harmony is guessed: every realization uses the frame's native
 * upper/bass templates. The phrase caller still applies all written rests. */
export function realizeEnsembleFills(notes: NoteEvent[], context: EnsembleFillContext): EnsembleFillResult {
  const { tick, duration, parameters: p } = context;
  if (![tick, duration].every(Number.isSafeInteger) || tick < 0 || duration <= 0) throw new RangeError('Ensemble fills need an integer frame.');
  const endTick = tick + duration;
  const plans = [...new Map(context.plans.map(plan => [plan.boundaryTick, plan])).values()].sort((a, b) => a.boundaryTick - b.boundaryTick);
  const rests = [...(context.rests ?? []), ...plans.flatMap(plan => plan.rests)];
  const fills: EnsembleFillSnapshot[] = [];
  if (context.additive || (context.cohesion ?? 1) <= 0 || !plans.length) return { notes, rests: [], fills };
  const templates = [...notes, ...(context.templates ?? []), ...(context.bassTemplate ? [context.bassTemplate] : [])];
  const nearest = (at: number, predicate: (note: NoteEvent) => boolean) => templates.filter(predicate)
    .sort((a, b) => Math.abs(a.tick - at) - Math.abs(b.tick - at) || compare(a.id, b.id))[0];
  const excursion = templates.some(note => (note.part === 'harmony' || note.part === 'bass') && note.endPitch && note.glideTicks);
  if (excursion) return { notes, rests: [], fills };
  const generated: NoteEvent[] = [];
  const freeMelody = (at: number, gate: number) => (context.previousVoiceEnds?.get(7) ?? -Infinity) <= at
    && !notes.some(note => note.part === 'melody' && note.voice === 7 && note.tick < at + gate && note.tick + note.duration > at)
    && !generated.some(note => note.voice === 7 && note.tick < at + gate && note.tick + note.duration > at);
  const soundable = (note: NoteEvent) => {
    if (rests.some(rest => restAppliesToNote(note, rest) && note.tick >= rest.startTick && note.tick < rest.endTick)) return undefined;
    let result: NoteEvent | undefined = note;
    for (const rest of rests) if (result && restAppliesToNote(result, rest) && rest.startTick > result.tick) result = shortened(result, rest.startTick);
    return result;
  };
  for (const plan of plans) {
    if (plan.endTick <= tick || plan.startTick >= endTick) continue;
    const id = `fill:${plan.kind}:${plan.boundaryTick}`;
    const destination = context.textureAt?.(plan.boundaryTick);
    const energy = destination ? Math.min(clamp(plan.energy * .72 + p.tension * .16 + p.rhythmicComplexity * .12), .15 + destination.rhythmDrive * .85)
      : clamp(plan.energy * .72 + p.tension * .16 + p.rhythmicComplexity * .12);
    const involvement = clamp(context.cohesion ?? 1);
    const grid = [...new Set(plan.notes.map(note => note.tick))].sort((a, b) => a - b);
    const preparation = grid.filter(at => at < plan.boundaryTick);
    const goals = plan.hierarchy?.filter(attack => attack.level === 'goal') ?? [];
    const shape = `${goals.length || 1} source groups · ${preparation.length} attacks → arrival`;
    const owned: NoteEvent[] = [];
    const add = (template: NoteEvent | undefined, at: number, gate: number, part: NoteEvent['part'], voice: number, pitch?: Pitch, phraseAccent = false) => {
      if (!template?.absolutePitch || at < tick || at >= endTick || template.endPitch || template.glideTicks) return;
      // The next frame may reveal an authored counter entrance. An inserted
      // answer never reserves musical space beyond our committed knowledge.
      if (part === 'melody') gate = Math.min(gate, endTick - at);
      // An inserted response belongs to this fill's breath too. This local
      // gate never clips a separately authored foreground/counter statement.
      for (const rest of plan.rests) if (rest.startTick > at) gate = Math.min(gate, rest.startTick - at);
      if (part === 'melody' && !freeMelody(at, gate)) return;
      const arrival = at === plan.boundaryTick;
      const progress = clamp((at - plan.startTick) / Math.max(1, plan.boundaryTick - plan.startTick));
      const texture = context.textureAt?.(at);
      let absolutePitch = pitch ?? template.absolutePitch;
      if (part !== 'harmony') {
        let degree = pitchToDegree(context.tuning, absolutePitch);
        const lowerUpper = Math.min(...templates.filter(note => note.part === 'harmony' && note.absolutePitch).map(note => pitchToMidi(note.absolutePitch!)));
        const low = part === 'bass' ? 28 : 62, high = part === 'bass' ? Math.min(52, lowerUpper - 7) : 91;
        if (high < low) return;
        while (pitchToMidi(degreeToPitch(context.tuning, degree)) < low) degree++;
        while (pitchToMidi(degreeToPitch(context.tuning, degree)) > high) degree--;
        absolutePitch = degreeToPitch(context.tuning, degree);
      }
      const factor = (part === 'melody' ? .78 : part === 'bass' ? .84 : .87) * (.65 + energy * .48)
        * (arrival ? destination && destination.pace < .3 ? .9 : 1.12 : phraseAccent ? 1 : .77 + progress * .18);
      const ceiling = texture && destination ? Math.min(texture.velocityCeiling,
        texture.velocityCeiling + (destination.velocityCeiling - texture.velocityCeiling) * progress) : .93;
      const candidate: NoteEvent = { ...template, id: `${id}:${at}:${part}:${voice}`, tick: at, duration: Math.max(1, Math.round(gate)), absolutePitch,
        voice, part, velocity: round(clamp(template.velocity * factor, 0, ceiling)),
        ...(texture ? { articulation: texture.articulation } : {}),
        ...(part === 'melody' ? { timbre: 'reed' as const } : {}),
        expression: { role: arrival ? 'anchor' : 'support', sourceId: id } };
      delete candidate.gainEnvelope; delete candidate.endPitch; delete candidate.glideTicks;
      if (context.tuning === '12tet') candidate.midiNote = pitchToMidi(absolutePitch); else delete candidate.midiNote;
      const bounded = soundable(candidate);
      if (bounded) { generated.push(bounded); owned.push(bounded); }
    };
    for (const [index, at] of grid.entries()) {
      if (at < tick || at >= endTick) continue;
      const arrival = at === plan.boundaryTick;
      const until = plan.boundaryTick - at;
      const progress = clamp((at - plan.startTick) / Math.max(1, plan.boundaryTick - plan.startTick));
      const texture = context.textureAt?.(at);
      const flowingPace = texture && destination ? texture.pace + (destination.pace - texture.pace) * progress : undefined;
      if (flowingPace !== undefined && flowingPace < .3 && !arrival && at % PPQ !== 0) continue;
      const final = preparation.slice(-Math.max(2, Math.ceil(2 + energy * 6))).includes(at);
      const hierarchy = plan.hierarchy?.find(attack => attack.tick === at);
      const level = hierarchy?.level ?? (until % PPQ === 0 ? 'pulse' : 'subdivision');
      const group = Math.max(0, goals.filter(goal => goal.tick <= at).length - 1);
      const strong = arrival || level === 'goal' || (hierarchy?.strength ?? 0) > .65;
      const gate = arrival ? Math.round(PPQ * (destination?.pace !== undefined && destination.pace < .3 ? 1.8 : energy > .65 ? .9 : 1.2))
        : Math.max(45, Math.round((energy > .7 ? 120 : 240) * (texture?.gateRatio ?? .78)));
      const bass = context.bassTemplate ?? nearest(at, note => note.part === 'bass' && !!note.absolutePitch);
      const upper = [0, 1, 2, 3].map(voice => nearest(at, note => note.part === 'harmony' && note.voice === voice && !!note.absolutePitch));
      const lead = nearest(at, note => note.part === 'melody' && !!note.absolutePitch && !note.endPitch) ?? upper[3];
      // Participation expands by musical role, not by copying every snare hit.
      const bassBeat = arrival || (energy < .3 ? at === preparation.at(-1)
        : level === 'goal' || level === 'pulse' && progress > .3 || final && strong);
      if (bassBeat && bass?.absolutePitch) add(bass, at, gate, 'bass', 4,
        chordalBassPitch({ bass: bass.absolutePitch, voices: upper.flatMap(note => note?.absolutePitch ? [note.absolutePitch] : []) }, context.tuning,
          { index, count: grid.length, group, iteration: 0, anchor: at === grid[0], arrival, mobility: p.bassMobility }), strong);
      const upperBeat = arrival || (energy < .3 ? at === preparation.at(-2)
        : level === 'goal' && progress > .25 || level === 'pulse' && final || level === 'subdivision' && energy > .7 && strong);
      if (upperBeat && involvement > .18) {
        const voice = arrival ? 0 : (group + Math.floor(progress * 4)) % 4;
        add(upper[voice], at, gate, 'harmony', voice, undefined, strong);
        if (energy > .6 && (arrival || final && level === 'goal')) {
          const other = voice === 0 ? 2 : 1; add(upper[other], at, gate, 'harmony', other, undefined, true);
        }
      }
      const melodyBeat = arrival || energy > .3 && final && level === 'subdivision';
      if (melodyBeat && involvement > .4) {
        let pitch = lead?.absolutePitch;
        if (!arrival && pitch) {
          const divisions = TUNINGS[context.tuning].divisions;
          const target = pitchToDegree(context.tuning, pitch) - (1 - progress) * divisions * .65;
          const candidates = upper.flatMap(note => {
            if (!note?.absolutePitch) return [];
            const degree = pitchToDegree(context.tuning, note.absolutePitch), choices: number[] = [];
            for (let displacement = -2; displacement <= 3; displacement++) {
              const candidate = degree + displacement * divisions, midi = pitchToMidi(degreeToPitch(context.tuning, candidate));
              if (midi >= 62 && midi <= 91) choices.push(candidate);
            }
            return choices;
          }).sort((a, b) => Math.abs(a - target) - Math.abs(b - target) || a - b);
          if (candidates.length) pitch = degreeToPitch(context.tuning, candidates[0]);
        }
        add(lead, at, arrival ? Math.round(PPQ * .85) : Math.min(gate, 108), 'melody', 7, pitch, strong);
      }
    }
    const audible = [...owned, ...notes.filter(note => note.part === 'percussion' && plan.notes.some(source => source.id === note.id))];
    const sharedTicks = [...new Set(audible.map(note => note.tick))].filter(at => new Set(audible.filter(note => note.tick === at).map(note => note.part)).size >= 3);
    fills.push({ id, boundaryTick: plan.boundaryTick, startTick: plan.startTick, endTick: plan.endTick, shape,
      energy: round(energy), parts: [...new Set(audible.map(note => note.part))], sharedTicks });
  }
  let output = [...notes];
  for (const added of generated) {
    output = output.flatMap(note => {
      if (!instrument(note, added) || note.part === 'melody' || note.endPitch) return [note];
      if (Math.abs(note.tick - added.tick) <= 30) return [];
      if (note.tick < added.tick && note.tick + note.duration > added.tick) { const clipped = shortened(note, added.tick); return clipped ? [clipped] : []; }
      return [note];
    });
    output.push(added);
  }
  const unique = [...new Map(output.map(note => [note.id, note])).values()];
  unique.sort((a, b) => a.tick - b.tick || a.voice - b.voice || compare(a.id, b.id));
  return { notes: unique, rests: [], fills };
}
