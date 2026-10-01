import type { FormState } from '../conductor';
import { TUNINGS, degreeToPitch, pitchToDegree, pitchToMidi, type Pitch, type TuningId } from '../pitch';
import type { NoteEvent, Parameters } from '../types';
import { clamp, round } from './analysis';
import type { CompositionConfig, IndependentLayerSnapshot } from '../composition';
import { restAppliesToNote, type PhraseRest } from '../phrasing';
import { planTransitions, type TransitionBoundary, type TransitionPlan } from './transitions';
import { textureIntentAt, type TextureAt } from './texture';
import { expressiveContourAt } from './expression';
import { withRhythmicScore, type RhythmicMoment } from './rhythmic-score';
import { metricStrength } from './idea-kernel';

export type GrooveConfiguration = Pick<CompositionConfig, 'displacement' | 'polymeter' | 'transition'>;
export interface GrooveHarmony { bass: Pitch; voices: readonly Pitch[]; nextBass?: Pitch; nextTick?: number; }
export interface BassFigurePosition {
  index: number; count: number; group: number; iteration: number;
  anchor: boolean; mobility: number; arrival?: boolean;
}

/** A bounded chordal figure, voiced in the bass register. The source grouping
 * orders chord members; its return approaches the known root through a nearby
 * chord member. No future harmony or chromatic note is invented here. */
export function chordalBassPitch(harmony: GrooveHarmony, tuning: TuningId, position: BassFigurePosition): Pitch {
  const octave = TUNINGS[tuning].divisions;
  const root = pitchToDegree(tuning, harmony.bass);
  const upper = Math.min(...harmony.voices.map(pitchToMidi));
  const low = Math.ceil((28 - 69) * octave / 12), high = Math.floor((Math.min(52, upper - 7) - 69) * octave / 12);
  const bound = (degree: number) => {
    while (degree > high) degree -= octave;
    while (degree < low && degree + octave <= high) degree += octave;
    return Math.max(low, Math.min(high, degree));
  };
  if (position.anchor || position.arrival || position.mobility <= .05 || !harmony.voices.length)
    return degreeToPitch(tuning, bound(root));
  const mod = (value: number) => (value % octave + octave) % octave;
  const classes = [...new Set(harmony.voices.map(pitch => mod(pitchToDegree(tuning, pitch) - root)))].filter(value => value !== 0).sort((a, b) => a - b);
  if (!classes.length) return degreeToPitch(tuning, bound(root));
  const phase = position.count <= 1 ? 0 : position.index / (position.count - 1);
  const approaching = position.index === position.count - 1;
  const member = approaching ? [...classes].sort((a, b) => Math.min(a, octave - a) - Math.min(b, octave - b))[0]
    : classes[(position.group + Math.floor(position.iteration / 2)) % classes.length];
  const candidates: number[] = [];
  for (let degree = low; degree <= high; degree++) if (mod(degree - root) === member) candidates.push(degree);
  if (!candidates.length) return degreeToPitch(tuning, bound(root));
  // A modest register arch gives later weak attacks room to answer the head.
  // The address is a whole group, never a per-hit random pitch decision.
  const target = bound(root) + (1 - Math.abs(phase * 2 - 1)) * octave * (.18 + position.mobility * .52);
  candidates.sort((a, b) => Math.abs(a - target) - Math.abs(b - target) || a - b);
  return degreeToPitch(tuning, candidates[0]);
}
export interface GrooveContext {
  composition: GrooveConfiguration;
  boundaries?: readonly TransitionBoundary[];
  transitionPlans?: readonly TransitionPlan[];
  rests?: readonly PhraseRest[];
  textureAt?: TextureAt;
  /** Current actual sonority; an optional future bass is a known score goal,
   * never a request to generate unknown future harmony. */
  harmonyAt?: (tick: number) => GrooveHarmony;
}

const bassBounds = (tuning: TuningId, upperFloor: number) => {
  const divisions = TUNINGS[tuning].divisions;
  return tuning === '12tet' ? { minimum: 28, maximum: Math.min(52, upperFloor - 7), octave: 12 }
    : { minimum: Math.ceil((28 - 69) * divisions / 12),
      maximum: Math.min(Math.floor((52 - 69) * divisions / 12), upperFloor - Math.ceil(7 * divisions / 12)), octave: divisions };
};

/** Layer diagnostics project the same score that generated the attacks. */
export function grooveLayersAt(tick: number, rhythm: RhythmicMoment): IndependentLayerSnapshot[] {
  return rhythm.layers.map(layer => {
    const cycleStartTick = layer.originTick + Math.floor((tick - layer.originTick) / layer.cycleTicks) * layer.cycleTicks;
    return { id: layer.id, role: 'rhythm', sourceId: layer.sourceId, cycleTicks: layer.cycleTicks,
      cycleStartTick, cycleEndTick: cycleStartTick + layer.cycleTicks, active: layer.active,
      label: layer.role === 'reference' ? `Reference quarter pulse · ${rhythm.feel} time`
        : layer.role === 'riff' ? `Riff · ${rhythm.riffShape.replaceAll('-', ' ')}` : `Response · ${rhythm.treatment}` };
  });
}

/** Read the common score at each actual onset. Its bass/kick state the same
 * subject while snare and cymbals retain complementary roles. Standalone and
 * production callers interpret the same source rhythm. */
function scoredGroove(tick: number, duration: number, p: Parameters, tuning: TuningId,
  bass: number, upperFloor: number, toPitch: (pitch: number) => Pitch, textureAt: TextureAt,
  formAt: (tick: number) => FormState, harmonyAt?: GrooveContext['harmonyAt']): NoteEvent[] {
  const notes: NoteEvent[] = [], end = tick + duration;
  for (let at = Math.ceil(tick / 60) * 60; at < end; at += 60) {
    const texture = textureAt(at), rhythm = texture.rhythm;
    if (!rhythm) continue;
    const intensity = .45 + p.dynamics * .5;
    for (const [name, midiNote, scale] of [['kick', 36, .75], ['snare', 38, .66], ['hat', 42, .47]] as const) {
      const hit = rhythm[name].find(hit => hit.tick === at);
      if (!hit) continue;
      notes.push({ id: `score:${rhythm.phraseId}:${at}:${name}`, tick: at,
        duration: midiNote === 42 ? 70 : midiNote === 38 ? 120 : 150,
        midiNote, velocity: round(clamp(Math.min(texture.velocityCeiling, hit.strength * scale * intensity))),
        voice: 9, part: 'percussion', expression: { role: hit.role === 'anchor' ? 'anchor' : 'support',
          sourceId: hit.layer === 'reference' ? 'reference:quarter' : rhythm.sourceId } });
    }
    const hit = rhythm.bass.find(hit => hit.tick === at);
    if (!hit) continue;
    const { octave, minimum, maximum } = bassBounds(tuning, upperFloor);
    let degree = bass;
    if (p.bassMobility > .6 && texture.pace > .55 && hit.role === 'answer' && (at - rhythm.cycleStartTick) >= rhythm.cycleTicks / 2) degree += octave;
    while (degree > maximum) degree -= octave;
    while (degree < minimum && degree + octave <= maximum) degree += octave;
    degree = Math.max(minimum, Math.min(maximum, degree));
    const harmony = harmonyAt?.(at), form = formAt(at);
    const metric = metricStrength(at, { originTick: form.barStartTick, beatTicks: 480 * 4 / form.meter.denominator,
      barTicks: form.barTicks, groups: form.meterGroups });
    const absolutePitch = harmony ? chordalBassPitch(harmony, tuning, {
      index: rhythm.bass.findIndex(note => note.tick === at), count: rhythm.bass.length,
      group: hit.group ?? 0, iteration: rhythm.iteration, anchor: hit.role === 'anchor' || metric === 1,
      mobility: p.bassMobility,
    }) : toPitch(degree);
    let nextTick = at + (texture.pace < .3 ? 1920 : 960);
    // Actual future attacks, including admission changes, are addressable
    // before the next frame exists. The bound is four beats, not unbounded
    // look-ahead planning. Quiet holds yield to a newly active shared riff.
    for (let future = at + 60; future < nextTick; future += 60) {
      const next = textureAt(future).rhythm;
      if (next?.rests.some(rest => future >= rest.startTick && future < rest.endTick)
        || next?.bass.some(note => note.tick === future)) { nextTick = future; break; }
    }
    const gate = texture.pace < .3 ? nextTick - at : Math.round((nextTick - at) * Math.min(.96, texture.gateRatio));
    notes.push({ id: `score:${rhythm.phraseId}:${at}:bass`, tick: at, duration: Math.max(30, gate),
      absolutePitch, ...(tuning === '12tet' ? { midiNote: pitchToMidi(absolutePitch) } : {}),
      velocity: round(clamp(Math.min(texture.velocityCeiling, hit.strength * .78 * intensity))),
      part: 'bass', voice: 4, timbre: 'round', articulation: texture.articulation,
      expression: { role: hit.role === 'anchor' ? 'anchor' : 'support', sourceId: rhythm.sourceId } });
  }
  return notes;
}

/** Interpret a supplied rhythmic score, or adapt standalone inputs through
 * that same score. Frame partitioning cannot select a different generator. */
export function grooveNotes(seed: string, tick: number, duration: number, formAt: (tick: number) => FormState, p: Parameters, tuning: TuningId, bass: number, upperFloor: number, toPitch: (pitch: number) => Pitch, context?: GrooveContext): NoteEvent[] {
  if (![tick, duration, tick + duration].every(Number.isSafeInteger) || tick < 0 || duration <= 0) throw new RangeError('A groove needs a positive integer tick window.');
  const composition = context?.composition ?? {};
  const supplied = context?.textureAt ?? (at => textureIntentAt(p, formAt(at), expressiveContourAt(seed, at, formAt)));
  const textureAt = withRhythmicScore(seed, formAt, p, supplied, composition);
  const plans = context?.transitionPlans ?? planTransitions(seed, context?.boundaries ?? [], p, composition.transition ?? 0);
  const base = scoredGroove(tick, duration, p, tuning, bass, upperFloor, toPitch, textureAt, formAt, context?.harmonyAt);
  const arrivals = plans.flatMap(plan => plan.notes.flatMap(note => {
    if (note.tick < tick || note.tick >= tick + duration) return [];
    const texture = textureAt(note.tick), destination = textureAt(plan.boundaryTick);
    const progress = clamp((note.tick - plan.startTick) / Math.max(1, plan.boundaryTick - plan.startTick));
    const pace = texture.pace + (destination.pace - texture.pace) * progress;
    if (pace < .3 && note.tick !== plan.boundaryTick && note.tick % 480) return [];
    const ceiling = Math.min(texture.velocityCeiling, texture.velocityCeiling + (destination.velocityCeiling - texture.velocityCeiling) * progress);
    return [{ ...note, velocity: round(Math.min(note.velocity * (.65 + pace * .35), ceiling * .8)) }];
  }));
  const scoreRests: PhraseRest[] = [];
  for (let at = Math.floor(tick / 60) * 60; at < tick + duration; at += 60) {
    for (const rest of textureAt(at).rhythm!.rests) {
      if (!scoreRests.some(found => found.startTick === rest.startTick && found.endTick === rest.endTick)) scoreRests.push(rest);
    }
  }
  const rests = [...(context?.rests ?? []), ...scoreRests, ...plans.flatMap(plan => plan.rests)];
  // A fill owns a drum's exact attack. Coincident score roles are one physical
  // strike, with the strongest planned velocity and the written rests intact.
  const byAttack = new Map<string, NoteEvent>();
  for (const note of [...base, ...arrivals]) {
    const key = note.part === 'percussion' ? `${note.tick}:${note.midiNote}` : note.id;
    const existing = byAttack.get(key);
    if (!existing || note.velocity > existing.velocity || note.id.startsWith('transition:')) byAttack.set(key, note);
  }
  return [...byAttack.values()].flatMap(original => {
    if (rests.some(rest => restAppliesToNote(original, rest) && original.tick >= rest.startTick && original.tick < rest.endTick)) return [];
    let endTick = original.tick + original.duration;
    for (const rest of rests) if (restAppliesToNote(original, rest) && rest.startTick > original.tick) endTick = Math.min(endTick, rest.startTick);
    return endTick > original.tick ? [{ ...original, duration: endTick - original.tick }] : [];
  }).sort((a, b) => a.tick - b.tick || a.voice - b.voice || (a.midiNote ?? 0) - (b.midiNote ?? 0));
}
