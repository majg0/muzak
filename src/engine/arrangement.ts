import type { FormState, InstrumentColor } from '../conductor';
import type { PhraseRest } from '../phrasing';
import { clipGainEnvelope, notePitchAt } from '../note-expression';
import { FRAME_TICKS, PPQ, type NoteEvent, type Parameters } from '../types';
import { texturePulseAt, type TextureAt } from './texture';

type PitchRange = readonly [number, number];
export interface PlayerDefinition {
  /** Stable physical line shared by synthesis, rests, score and MIDI. */
  voice: number;
  role: 'subject' | 'foundation' | 'voicing' | 'counterline' | 'reinforcement' | 'figuration';
  instrument?: InstrumentColor | 'form';
  /** An absent source means an already composed independent line. */
  source?: { part: NoteEvent['part']; voice?: number };
  part?: NoteEvent['part'];
  gain?: number;
  register?: { octaves: readonly number[]; range?: PitchRange; preserveSubject?: boolean };
  /** An absent rhythm quotes source onsets, durations and expressive gestures. */
  rhythm?: { minimumPace: number; gateTicks: number; direction: 'ascending' | 'descending' | 'arch' };
}
export interface ArrangementPlan {
  /** Ordered entrances; ensemble size admits a prefix, independently of pace. */
  players: readonly PlayerDefinition[];
  percussionEntrance: number;
}

/** Instrument, source, register and rhythm are independent policies. Adding a
 * player does not add a branch to the realization algorithm. */
export const DEFAULT_ARRANGEMENT: ArrangementPlan = {
  percussionEntrance: .28,
  players: [
    { voice: 5, role: 'subject' },
    { voice: 4, role: 'foundation', instrument: 'round' },
    { voice: 0, role: 'voicing', instrument: 'strings' },
    { voice: 3, role: 'voicing', instrument: 'flute' },
    { voice: 1, role: 'voicing', instrument: 'reed' },
    { voice: 2, role: 'voicing', instrument: 'strings' },
    { voice: 8, role: 'counterline', instrument: 'form' },
    { voice: 10, role: 'reinforcement', instrument: 'strings', source: { part: 'bass' }, part: 'harmony', gain: .62,
      register: { octaves: [1, 0, -1], range: [2_800_000, 8_800_000] } },
    { voice: 11, role: 'reinforcement', instrument: 'flute', source: { part: 'melody', voice: 5 }, gain: .52,
      register: { octaves: [1, 0, -1], range: [6_000_000, 9_600_000], preserveSubject: true } },
    { voice: 12, role: 'reinforcement', instrument: 'brass', source: { part: 'harmony', voice: 0 }, gain: .60,
      register: { octaves: [0, 1, -1], range: [3_400_000, 8_200_000] } },
    { voice: 13, role: 'reinforcement', instrument: 'strings', source: { part: 'harmony', voice: 3 }, gain: .48,
      register: { octaves: [1, 0, -1], range: [4_800_000, 10_000_000] } },
    { voice: 14, role: 'figuration', instrument: 'keys', source: { part: 'harmony' }, gain: .62,
      register: { octaves: [1, 0, -1], range: [2_100_000, 10_800_000] },
      rhythm: { minimumPace: .38, gateTicks: Math.round(PPQ * .4), direction: 'arch' } },
  ],
};

const octaveSize = 1_200_000;
const pitchOf = (note: NoteEvent) => note.absolutePitch?.millicents ?? (note.midiNote === undefined ? undefined : note.midiNote * 100_000);
const matches = (note: NoteEvent, player: PlayerDefinition) => !!player.source && note.part === player.source.part
  && (player.source.voice === undefined || note.voice === player.source.voice);

export function arrangementAt(size: number, form: FormState, plan: ArrangementPlan = DEFAULT_ARRANGEMENT) {
  validatePlan(plan);
  if (!Number.isFinite(size)) throw new RangeError('Ensemble size must be finite.');
  size = Math.max(0, Math.min(1, size));
  const count = 1 + Math.floor(size * (plan.players.length - 1) + .000001);
  const players = plan.players.slice(0, count);
  const palette: Record<number, InstrumentColor> = {};
  for (const player of players) if (player.instrument) palette[player.voice] = player.instrument === 'form' ? form.instrument : player.instrument;
  return { name: count === 1 ? 'Exposed line' : count <= 3 ? 'Small group' : count <= 6 ? 'Chamber ensemble'
    : count <= 9 ? 'Expanded ensemble' : 'Full ensemble', size, voices: players.map(player => player.voice), palette,
    percussion: size >= plan.percussionEntrance };
}

export interface ArrangementContext {
  seed: string; tick: number; duration: number; additive: boolean;
  parametersAt: (tick: number) => Parameters; formAt: (tick: number) => FormState;
  textureAt: TextureAt; upper: readonly NoteEvent[];
  /** Complete protected argument, not only the notes in this scheduling frame. */
  melodyRangeMillicents?: PitchRange;
  /** Complete source ranges allow any registered subject to retain its contour. */
  sourceRangesMillicents?: Readonly<Record<number, PitchRange>>;
  plan?: ArrangementPlan;
}

function validatePlan(plan: ArrangementPlan) {
  if (!plan.players.length || new Set(plan.players.map(player => player.voice)).size !== plan.players.length
    || !Number.isFinite(plan.percussionEntrance) || plan.percussionEntrance < 0 || plan.percussionEntrance > 1)
    throw new RangeError('An arrangement needs distinct players and a percussion entrance between zero and one.');
  for (const player of plan.players) {
    const register = player.register, rhythm = player.rhythm;
    if (!Number.isSafeInteger(player.voice) || player.voice < 0 || player.voice === 9
      || !Number.isFinite(player.gain ?? 1) || (player.gain ?? 1) < 0
      || register && (!register.octaves.length || register.octaves.some(octave => !Number.isSafeInteger(octave))
        || register.range && (!register.range.every(Number.isSafeInteger) || register.range[0] > register.range[1]))
      || rhythm && (!player.source || !Number.isSafeInteger(rhythm.gateTicks) || rhythm.gateTicks <= 0
        || !Number.isFinite(rhythm.minimumPace) || rhythm.minimumPace < 0 || rhythm.minimumPace > 1))
      throw new RangeError('Player policies need valid voices, registers, gains and rhythmic gates.');
  }
}

function realizePlayer(source: NoteEvent, player: PlayerDefinition, context: ArrangementContext): NoteEvent | undefined {
  const pitch = pitchOf(source);
  if (pitch === undefined) return;
  const register = player.register, range = register?.range;
  const complete = context.sourceRangesMillicents?.[source.voice]
    ?? (source.voice === 5 ? context.melodyRangeMillicents : undefined);
  const extent: PitchRange = register?.preserveSubject && complete ? complete
    : [Math.min(pitch, source.endPitch?.millicents ?? pitch), Math.max(pitch, source.endPitch?.millicents ?? pitch)];
  // Without a complete subject range, preserve the source register. Choosing
  // a new octave for each note would silently fold the identifying contour.
  const candidates = register?.preserveSubject && !complete ? [0] : register?.octaves ?? [0];
  const octave = candidates.find(candidate => !range || extent[0] + candidate * octaveSize >= range[0]
    && extent[1] + candidate * octaveSize <= range[1]);
  if (octave === undefined) return;
  const shift = octave * octaveSize;
  if (range && [pitch, source.endPitch?.millicents ?? pitch].some(value => value + shift < range[0] || value + shift > range[1])) return;
  const timbre = player.instrument === 'form' ? context.formAt(Math.floor(source.tick / FRAME_TICKS) * FRAME_TICKS).instrument : player.instrument ?? source.timbre;
  return { ...source, id: `${source.id}:player:${player.voice}`, voice: player.voice, timbre,
    part: player.part ?? source.part, velocity: source.velocity * (player.gain ?? 1),
    ...(source.absolutePitch ? { absolutePitch: { millicents: source.absolutePitch.millicents + shift } } : {}),
    ...(source.endPitch ? { endPitch: { millicents: source.endPitch.millicents + shift } } : {}),
    ...(source.midiNote === undefined ? {} : { midiNote: source.midiNote + octave * 12 }),
    expression: { ...source.expression, role: 'support', sourceId: source.expression?.sourceId ?? source.id } };
}

/** Read authored accents directly, including tuplets and displaced attacks.
 * The fallback reads the texture's own subdivision rather than imposing one. */
function sharedAttacks(context: ArrangementContext, endTick: number) {
  const result = new Map<number, { tick: number; strength: number; ordinal: number }>();
  for (let cursor = context.tick; cursor < endTick;) {
    const texture = context.textureAt(cursor), rhythm = texture.rhythm;
    const boundary = (Math.floor(cursor / FRAME_TICKS) + 1) * FRAME_TICKS;
    if (rhythm) {
      const until = Math.min(endTick, boundary, rhythm.endTick, rhythm.cycleStartTick + rhythm.cycleTicks);
      if (until <= cursor) throw new RangeError('A rhythmic moment must contain its requested tick.');
      const accents = [...rhythm.accents].sort((a, b) => a.tick - b.tick);
      accents.forEach((attack, ordinal) => {
        if (attack.tick >= cursor && attack.tick < until && attack.strength > 0) {
          const prior = result.get(attack.tick);
          if (!prior || prior.strength < attack.strength) result.set(attack.tick, { ...attack, ordinal });
        }
      });
      cursor = until;
    } else {
      const step = texture.subdivisionTicks;
      if (!Number.isSafeInteger(step) || step <= 0) throw new RangeError('Texture subdivisions must be positive integer ticks.');
      const at = Math.ceil(cursor / step) * step;
      if (at < endTick && at < boundary) {
        const strength = texturePulseAt(context.seed, at, context.textureAt(at));
        if (strength > 0) result.set(at, { tick: at, strength, ordinal: Math.floor(at / step) });
      }
      cursor = Math.min(boundary, at + step);
    }
  }
  return [...result.values()].sort((a, b) => a.tick - b.tick);
}

/** A struck gesture begins at the sounding pitch of its source. Copying the
 * original glide would restart an old trajectory at every new attack. */
function restrike(source: NoteEvent, tick: number, duration: number): NoteEvent {
  const { gainEnvelope: _gain, endPitch: _end, glideTicks: _glide, ...base } = source;
  const note = { ...base, tick, duration, articulation: 'detached' as const };
  if (!source.absolutePitch || !source.endPitch) return note;
  const glideTicks = source.glideTicks ?? source.duration;
  const sample = (at: number) => notePitchAt(source, at)!;
  const remaining = Math.min(duration, source.tick + glideTicks - tick);
  const result = { ...note, absolutePitch: sample(tick), ...(remaining > 0 ? { endPitch: sample(tick + remaining), glideTicks: remaining } : {}) };
  delete result.midiNote;
  return result;
}

/** The orchestra interprets composed subjects and harmonic sources. Extra
 * voices have traceable parents; orchestration never invents pitch material. */
export function realizeArrangement(notes: NoteEvent[], context: ArrangementContext): {
  notes: NoteEvent[]; rests: PhraseRest[]; diagnostic: { name: string; size: number; voices: number[]; colors: InstrumentColor[] };
} {
  const { tick, duration, parametersAt, formAt, textureAt } = context, plan = context.plan ?? DEFAULT_ARRANGEMENT;
  if (![tick, duration, tick + duration].every(Number.isSafeInteger) || tick < 0 || duration <= 0)
    throw new RangeError('Arrangement requires a nonnegative integer tick and positive integer duration.');
  if (context.additive) return { notes, rests: [], diagnostic: { name: 'Matched additive sonority', size: 1,
    voices: [...new Set(notes.filter(n => n.part !== 'percussion').map(n => n.voice))], colors: [] } };
  // Entrances, exits, colors and rest declarations share the commit clock.
  const rosters = new Map<number, ReturnType<typeof arrangementAt>>();
  const at = (t: number) => {
    const boundary = Math.floor(t / FRAME_TICKS) * FRAME_TICKS;
    let roster = rosters.get(boundary);
    if (!roster) { roster = arrangementAt(parametersAt(boundary).ensembleSize, formAt(boundary), plan); rosters.set(boundary, roster); }
    return roster;
  };
  const allowed = (note: NoteEvent, t: number) => note.part === 'percussion' ? at(t).percussion : at(t).voices.includes(note.voice);
  const current = at(tick), output: NoteEvent[] = [];
  const doubles = plan.players.filter(player => player.source && !player.rhythm);
  for (const note of notes) {
    if (allowed(note, note.tick)) {
      const color = at(note.tick).palette[note.voice];
      output.push(color ? { ...note, timbre: color } : note);
    }
    for (const player of doubles) if (at(note.tick).voices.includes(player.voice) && matches(note, player)) {
      const doubled = realizePlayer(note, player, context);
      if (doubled) output.push(doubled);
    }
  }
  for (const player of plan.players.filter(player => player.rhythm)) {
    if (!context.upper.some(source => matches(source, player))) continue;
    const policy = player.rhythm!, endTick = tick + duration;
    // Look ahead one gate so partitioning a scheduling window cannot change
    // whether a line releases before its next authored attack.
    const attacks = sharedAttacks(context, endTick + policy.gateTicks);
    attacks.forEach((attack, index) => {
      const t = attack.tick;
      if (t >= endTick || !at(t).voices.includes(player.voice) || textureAt(t).pace < policy.minimumPace) return;
      const byVoice = new Map<number, NoteEvent>();
      for (const source of context.upper) if (matches(source, player) && source.tick <= t && pitchOf(source) !== undefined) {
        const prior = byVoice.get(source.voice);
        if (!prior || source.tick > prior.tick || source.tick === prior.tick && source.id < prior.id) byVoice.set(source.voice, source);
      }
      const available = [...byVoice.values()].filter(source => source.tick + source.duration > t)
        .sort((a, b) => pitchOf(a)! - pitchOf(b)! || a.voice - b.voice);
      if (!available.length) return;
      const cycle = policy.direction === 'arch' ? Math.max(1, (available.length - 1) * 2) : available.length;
      const position = attack.ordinal % cycle;
      const rank = policy.direction === 'descending' ? available.length - 1 - position
        : policy.direction === 'arch' && position >= available.length ? cycle - position : position;
      const source = available[rank];
      const replacement = context.upper.filter(note => matches(note, player) && note.voice === source.voice && note.tick > t)
        .reduce((end, note) => Math.min(end, note.tick), Infinity);
      const end = Math.min(t + policy.gateTicks, source.tick + source.duration, replacement, attacks[index + 1]?.tick ?? Infinity);
      const realized = realizePlayer(restrike(source, t, end - t), player, context);
      if (realized) output.push({ ...realized, id: `arrangement:arp:${player.voice}:${t}`, velocity: realized.velocity * (.7 + attack.strength * .3) });
    });
  }
  const rests: PhraseRest[] = [];
  for (let start = tick; start < tick + duration;) {
    const roster = at(start), end = Math.min(tick + duration, (Math.floor(start / FRAME_TICKS) + 1) * FRAME_TICKS);
    const voices = [...plan.players.filter(player => !roster.voices.includes(player.voice)).map(player => player.voice), ...(!roster.percussion ? [9] : [])];
    if (voices.length) rests.push({ startTick: start, endTick: end, scope: 'ensemble', voices, kind: 'player-exit',
      reason: 'Players outside the current arrangement are silent.' });
    start = end;
  }
  const result = output.map(note => {
    let end = note.tick + note.duration;
    for (let boundary = (Math.floor(note.tick / FRAME_TICKS) + 1) * FRAME_TICKS; boundary < end; boundary += FRAME_TICKS)
      if (!allowed(note, boundary)) { end = boundary; break; }
    if (end === note.tick + note.duration) return note;
    return { ...note, duration: end - note.tick, gainEnvelope: clipGainEnvelope(note.gainEnvelope, end - note.tick),
      ...(note.endPitch ? { glideTicks: note.glideTicks ?? note.duration } : {}) };
  });
  return { notes: result, rests, diagnostic: { name: current.name, size: current.size, voices: current.voices,
    colors: [...new Set(result.filter(note => note.part !== 'percussion').map(note => note.timbre).filter((c): c is InstrumentColor => !!c))] } };
}
