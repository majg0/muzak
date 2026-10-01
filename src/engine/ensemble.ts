import type { CompositionConfig, StructuralCue } from '../composition';
import { restAppliesToNote, type PhraseRest } from '../phrasing';
import type { NoteEvent } from '../types';
import { random } from './random';
import { clipGainEnvelope } from '../note-expression';
import type { TextureAt } from './texture';

export interface EnsembleContext {
  textureAt?: TextureAt;
  lyrical?: boolean;
  seed?: string;
  tick: number;
  duration: number;
  beatTicks: number;
  cues: readonly StructuralCue[];
  rests: readonly PhraseRest[];
  additive: boolean;
  config: CompositionConfig;
  /** The section's larger dynamic arc, centered on .5. */
  intensity?: number;
  /** Engine orchestration applies dynamics once after all independent parts. */
  deferDynamics?: boolean;
  /** Original frame events, before accompaniment has been thinned. */
  templates?: readonly NoteEvent[];
  /** Current independent bass, even when its groove has no attack this frame. */
  bassTemplate?: NoteEvent;
}

const clamp = (value: number, low = 0, high = 1) => Math.max(low, Math.min(high, value));
const rounded = (value: number) => Math.round(value * 1e6) / 1e6;
const compareId = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const applies = restAppliesToNote;
const sameInstrument = (a: NoteEvent, b: NoteEvent) => a.part === b.part && a.voice === b.voice && (a.part !== 'percussion' || a.midiNote === b.midiNote);

export function ensembleDynamicGain(intensity: number, breadth: number): number {
  intensity = clamp(intensity); breadth = clamp(breadth);
  // Quiet expression remains audible. Pacing, spectrum, articulation and
  // fewer attacks carry a retreat; amplitude must not erase its musical line.
  const position = intensity <= .5 ? intensity * 2 : (intensity - .5) * 2;
  const eased = position * position * (3 - 2 * position);
  const reading = intensity <= .5 ? .48 + .52 * eased : 1 + .75 * eased;
  return 1 + breadth * (reading - 1);
}

/** Final dynamic realization includes late-arriving counterlines and fills. */
export function applyEnsembleDynamics(notes: NoteEvent[], intensity: number, breadth: number, additive: boolean, textureAt?: TextureAt): NoteEvent[] {
  const gain = ensembleDynamicGain(intensity, breadth);
  return notes.map(note => additive && note.part !== 'percussion' ? note
    : { ...note, velocity: rounded(clamp(note.velocity * gain, 0, textureAt?.(note.tick).velocityCeiling ?? .98)) });
}

function shorten(note: NoteEvent, end: number): NoteEvent | undefined {
  const duration = Math.min(note.duration, Math.floor(end) - note.tick);
  if (duration <= 0) return undefined;
  if (duration === note.duration) return note;
  const result = { ...note, duration };
  if (note.gainEnvelope) result.gainEnvelope = clipGainEnvelope(note.gainEnvelope, duration);
  if (note.glideTicks && note.absolutePitch && note.endPitch && duration < note.glideTicks) {
    result.endPitch = { millicents: Math.round(note.absolutePitch.millicents + (note.endPitch.millicents - note.absolutePitch.millicents) * duration / note.glideTicks) };
    result.glideTicks = duration;
  }
  return result;
}

/** Structural agreement is sparse: a few actual lead attacks receive upper
 * support, independent bass and one drum punctuation. Other groove onsets do
 * not move. Cohesion controls these shared attacks; accent and dynamic breadth
 * separately control the written velocities. No pitches are invented from
 * harmony to stand in for a missing bass template.
 *
 * The additive experiment intentionally uses fixed amplitudes in synthesis;
 * it does not realize velocity contrast. Its pitched events remain unchanged
 * here (except required source-rest clipping), preserving the matched model.
 * Shared break/release gaps must also be in the phrase snapshot's rests so
 * live playback can release voices committed in an earlier frame. */
export function coordinateEnsemble(notes: NoteEvent[], context: EnsembleContext): NoteEvent[] {
  const { tick, duration, beatTicks: beat, additive, config } = context;
  if (![tick, duration, beat].every(Number.isSafeInteger) || tick < 0 || duration <= 0 || beat <= 0) throw new RangeError('Ensemble coordination needs a positive integer frame and beat.');
  const cohesion = clamp(config.cohesion), accent = clamp(config.accent), breadth = clamp(config.dynamicRange);
  if (cohesion === 0 && accent === 0 && breadth === 0) return notes;
  const frameEnd = tick + duration;
  const cueMap = new Map<string, StructuralCue>();
  for (const cue of context.cues) {
    if (!Number.isSafeInteger(cue.tick) || !Number.isFinite(cue.strength) || cue.tick < 0 || cue.endTick !== undefined && (!Number.isSafeInteger(cue.endTick) || cue.endTick <= cue.tick)) continue;
    const key = `${cue.id}:${cue.tick}`;
    if (!cueMap.has(key) || cue.strength > cueMap.get(key)!.strength) cueMap.set(key, cue);
  }
  const cues = [...cueMap.values()].sort((a, b) => a.tick - b.tick || b.strength - a.strength || compareId(a.id, b.id));
  const rests = [...context.rests, ...cues.filter(cue => (cue.kind === 'break' || cue.kind === 'release') && cue.endTick !== undefined)
    .map(cue => ({ startTick: cue.tick, endTick: cue.endTick!, scope: 'ensemble' as const, reason: `Shared ${cue.kind}.` }))];
  const inRest = (note: NoteEvent) => rests.some(rest => applies(note, rest) && note.tick >= rest.startTick && note.tick < rest.endTick);
  const templates = [...notes, ...(context.templates ?? []), ...(context.bassTemplate ? [context.bassTemplate] : [])];
  // An active tuning excursion has its own continuous pitch trajectory. A new
  // struck copy would neither represent that trajectory nor the model's bed.
  const glidingBed = templates.some(note => (note.part === 'harmony' || note.part === 'bass') && note.endPitch && note.glideTicks);
  let output = [...notes];
  let previousAttack = -Infinity;
  for (const cue of cues) {
    if (context.lyrical && !context.textureAt) continue;
    if (cohesion === 0 || cue.tick < tick || cue.tick >= frameEnd || !['entry', 'accent', 'arrival'].includes(cue.kind) || cue.strength <= 0) continue;
    // Even a detailed melody cannot turn support into an every-note unison.
    if (cue.tick - previousAttack < beat / (cue.ensemble === 'cell' ? 4 : 2)) continue;
    const strength = clamp(cue.strength);
    const texture = context.textureAt?.(cue.tick);
    if (texture && texture.pace < .3 && cue.kind === 'accent') continue;
    // Carrying a phrase is one orchestration decision for its whole source,
    // not a fresh player lottery at each note. Percussion still keeps its
    // independent pulse between the explicitly shared subdivisions.
    const identity = cue.ensemble === 'cell' ? cue.sourceId ?? cue.id : cue.id;
    const participates = (part: string) => random(context.seed ?? cue.id, 'ensemble-support', identity, part) < Math.min(1, cohesion * (cue.ensemble === 'cell' ? 1.15 : .45 + strength * .8));
    const near = Math.max(1, Math.round(beat / 8));
    const gate = Math.max(1, Math.round(beat * (cue.ensemble === 'cell' ? .55 : cue.kind === 'arrival' ? 1.1 : cue.kind === 'entry' ? .72 : .4)));
    const nearest = (predicate: (note: NoteEvent) => boolean) => templates.filter(predicate)
      .map((note, index) => ({ note, index })).sort((a, b) => Math.abs(a.note.tick - cue.tick) - Math.abs(b.note.tick - cue.tick) || a.index - b.index)[0]?.note;
    const supports: NoteEvent[] = [];
    const support = (template: NoteEvent, tag: string, multiplier: number, length: number) => {
      if (template.endPitch || template.glideTicks) return;
      const end = Math.min(cue.endTick ?? Infinity, cue.tick + length);
      const candidate: NoteEvent = { ...template, id: `ensemble:${cue.id}:${cue.tick}:${tag}`, tick: cue.tick, duration: Math.max(1, end - cue.tick),
        velocity: rounded(clamp(template.velocity * multiplier, 0, texture?.velocityCeiling ?? 1)),
        ...(texture && template.part !== 'percussion' ? { articulation: texture.articulation } : {}),
        expression: { role: 'support', sourceId: template.id, cueId: cue.id } };
      // A punctuation is its own short gesture, not a truncated copy of a
      // soft sweep's attack. Its normal instrumental envelope shapes it.
      delete candidate.gainEnvelope;
      if (!inRest(candidate)) supports.push(candidate);
    };
    // A calm landscape agrees through a low punctuation while the remaining
    // upper lines keep breathing. Re-striking them at every cell accent would
    // erase the long sweeps even though their written gates were long.
    const sweeping = (context.intensity ?? .5) < .36;
    const harmonicCue = !sweeping || cue.kind === 'arrival' || cue.kind === 'entry' && strength >= .85;
    if (!additive && !glidingBed && harmonicCue && participates('harmony')) {
      const upper = [...new Set(templates.filter(note => note.part === 'harmony').map(note => note.voice))].sort((a, b) => a - b);
      // Low/middle voices punctuate; the full upper block need not retrigger.
      for (const voice of upper.filter((_, index) => index % 2 === 0).slice(0, sweeping ? 1 : 2)) {
        const template = nearest(note => note.part === 'harmony' && note.voice === voice && !!note.absolutePitch);
        if (template) support(template, `harmony:${voice}`, .95, gate);
      }
    }
    if (!additive && !glidingBed && participates('bass')) {
      const template = nearest(note => note.part === 'bass' && !!note.absolutePitch);
      if (template) support(template, 'bass:4', .98, Math.max(1, Math.round(gate * .88)));
    }
    if (participates('percussion')) {
      const existing = nearest(note => note.part === 'percussion' && (note.midiNote === 36 || note.midiNote === 38) && Math.abs(note.tick - cue.tick) <= near);
      const key = existing?.midiNote ?? (cue.kind === 'accent' ? 38 : 36);
      const template = existing ?? nearest(note => note.part === 'percussion' && note.midiNote === key) ?? nearest(note => note.part === 'percussion');
      if (template) support({ ...template, midiNote: key, velocity: Math.max(.24, template.velocity) }, `percussion:${key}`, .95, Math.min(gate, 150));
    }
    if (!supports.length) continue;
    previousAttack = cue.tick;
    for (const attack of supports) {
      output = output.flatMap(note => {
        if (note.part === 'melody' || !sameInstrument(note, attack)) return [note];
        if (Math.abs(note.tick - cue.tick) <= near && !note.endPitch) return [];
        if (note.tick < cue.tick && note.tick + note.duration > cue.tick && !note.endPitch) {
          const ended = shorten(note, cue.tick - Math.min(8, Math.round(beat / 32)));
          return ended ? [ended] : [];
        }
        return [note];
      });
      output.push(attack);
    }
  }
  const dynamicGain = context.deferDynamics ? 1 : ensembleDynamicGain(context.intensity ?? .5, breadth);
  output = output.flatMap(original => {
    if (inRest(original)) return [];
    let note = original;
    for (const rest of rests) if (applies(note, rest) && rest.startTick > note.tick && rest.startTick < note.tick + note.duration) {
      const clipped = shorten(note, rest.startTick);
      if (!clipped) return [];
      note = clipped;
    }
    if (!additive || note.part === 'percussion') {
      const cueStrength = cues.filter(cue => cue.tick === note.tick && ['entry', 'accent', 'arrival'].includes(cue.kind))
        .reduce((maximum, cue) => Math.max(maximum, clamp(cue.strength)), 0);
      const strong = note.expression?.role === 'anchor' ? Math.max(.65, cueStrength) : cueStrength;
      const contrast = strong > 0 ? 1 + accent * strong * .42 : 1 - accent * (note.expression?.role === 'ornament' ? .36 : .12);
      // Deferred amplitudes are internal; clamp only after the shared gain so
      // a quiet accented note is not prematurely clipped before its retreat.
      const velocity = rounded(clamp(note.velocity * dynamicGain * contrast, 0, context.deferDynamics ? 2 : .98));
      if (velocity !== note.velocity) note = { ...note, velocity };
    }
    return [note];
  });
  return output.sort((a, b) => a.tick - b.tick || a.voice - b.voice || compareId(a.id, b.id));
}
