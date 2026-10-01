import { normalizeComposition, type CompositionConfig, type IndependentLayerSnapshot } from '../composition';
import type { FormState } from '../conductor';
import { TUNINGS, degreeToPitch, pitchToDegree, pitchToMidi, type Pitch, type TuningId } from '../pitch';
import { PPQ, type NoteEvent, type Parameters } from '../types';
import { integer, random } from './random';
import type { TextureAt } from './texture';
import { composeThemeCore, themeThird, type ThemeCoreSnapshot } from './theme-core';
import { lyricalField } from './lyrical-support';
import { notePitchAt } from '../note-expression';
import { choosePlannedIdea, type IdeaPlan, type ToolCoverage } from './idea-selection';

export interface CounterpointSubjectNote {
  sourceId: string; tick: number; duration: number; absolutePitch: Pitch; strength?: number;
}
export interface CounterpointIntent {
  fidelity: number; smoothness: number; independence: number;
  dissonance: number; development: number; register: number;
}
export const DEFAULT_COUNTERPOINT_INTENT: CounterpointIntent = {
  fidelity: .8, smoothness: .9, independence: 1, dissonance: 0, development: .6, register: .4,
};
export interface CounterpointContext {
  /** Actual events, including held notes that began before the query window. */
  notes?: readonly NoteEvent[];
  /** Complete foreground score, used where actual lead events are unavailable. */
  foreground?: readonly NoteEvent[];
  rangeCents?: readonly [number, number];
  voice?: number;
  /** Native pitch classes permitted by the source's field. */
  pitchClasses?: readonly number[];
  /** Optional committed occurrence intent; never advanced by reading a frame. */
  selection?: { seed: string; address: string; plan: IdeaPlan };
}
export interface CounterpointEvaluation {
  identity: number; continuity: number; independence: number; consonance: number; register: number;
  total: number;
}
export interface CounterpointRealization {
  notes: CounterpointSubjectNote[];
  evaluation: CounterpointEvaluation;
  candidatesEvaluated: number;
  relationship: 'imitation' | 'contrary development';
  coverage?: ToolCoverage;
}
export const COUNTERPOINT_TOOLS = ['imitation', 'contrary development'] as const;
const clamp = (n: number, low = 0, high = 1) => Math.max(low, Math.min(high, n));
const mod = (n: number, period: number) => ((n % period) + period) % period;
const emptyEvaluation = (): CounterpointEvaluation => ({ identity: 0, continuity: 0, independence: 0, consonance: 0, register: 0, total: 0 });
type Sounding = { note: NoteEvent; cents: number; overlap: number; samples: Array<{ cents: number; weight: number }> };
function soundingAt(subject: CounterpointSubjectNote, context: CounterpointContext): Sounding[] {
  const overlaps = (note: NoteEvent) => note.voice !== (context.voice ?? 8) && note.part !== 'percussion'
    && (note.absolutePitch || note.midiNote !== undefined) && note.tick < subject.tick + subject.duration && note.tick + note.duration > subject.tick;
  const actual = (context.notes ?? []).filter(overlaps);
  const preview = (context.foreground ?? []).filter(overlaps).filter(note => !actual.some(played =>
    played.part === 'melody' && played.voice === note.voice && played.tick < note.tick + note.duration && played.tick + played.duration > note.tick));
  return [...actual, ...preview].map(note => {
    const from = Math.max(note.tick, subject.tick), to = Math.min(note.tick + note.duration, subject.tick + subject.duration);
    const cents = notePitchAt(note, (from + to) / 2)!.millicents / 1000;
    // Bounded Simpson integration hears the passage through a glide, rather
    // than treating its onset or destination as the entire sounding event.
    const samples = note.endPitch ? [{ at: from, weight: 1 / 6 }, { at: (from + to) / 2, weight: 4 / 6 }, { at: to, weight: 1 / 6 }]
      .map(sample => ({ cents: notePitchAt(note, sample.at)!.millicents / 1000, weight: sample.weight })) : [{ cents, weight: 1 }];
    return { note, cents, samples, overlap: (to - from) / subject.duration };
  });
}
function compareDegrees(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}
function score(e: CounterpointEvaluation, intent: CounterpointIntent): number {
  return e.identity * (.7 + intent.fidelity * 2.8) + e.continuity * (.12 + intent.smoothness * .8)
    + e.independence * (.3 + intent.independence * 2) + e.consonance * 2.4 + e.register * .18;
}

/** Complete gestures compete under separable musical objectives. Native pitch
 * locations, source intervals, sounding overlaps, and paired voice motion all
 * participate; there are no style names, chord recipes, or random pitch draws.
 * With no other voice to negotiate, a feasible literal quotation wins. */
export function composeCounterpoint(subject: readonly CounterpointSubjectNote[], tuning: TuningId,
  requested: CounterpointIntent, context: CounterpointContext = {}): CounterpointRealization {
  if (!subject.length) return { notes: [], evaluation: emptyEvaluation(), candidatesEvaluated: 0, relationship: 'imitation' };
  const intent = Object.fromEntries(Object.entries(DEFAULT_COUNTERPOINT_INTENT).map(([key, fallback]) => {
    const value = requested[key as keyof CounterpointIntent];
    return [key, Number.isFinite(value) ? clamp(value) : fallback];
  })) as unknown as CounterpointIntent;
  const [low, high] = context.rangeCents ?? [5400, 7900];
  if (!Number.isFinite(low) || !Number.isFinite(high) || low > high) throw new RangeError('Counterpoint requires an ordered finite pitch range.');
  if (subject.some((note, i) => !Number.isSafeInteger(note.tick) || !Number.isSafeInteger(note.duration) || note.duration <= 0
    || !Number.isFinite(note.absolutePitch.millicents) || i > 0 && note.tick < subject[i - 1].tick + subject[i - 1].duration))
    throw new RangeError('A counterpoint subject must contain ordered, non-overlapping notes of positive integer duration.');
  const period = TUNINGS[tuning].divisions, centsPerDegree = 1200 / period;
  const source = subject.map(note => pitchToDegree(tuning, note.absolutePitch));
  const first = pitchToDegree(tuning, { millicents: low * 1000 }) - 1;
  const last = pitchToDegree(tuning, { millicents: high * 1000 }) + 1;
  const allowed = Array.from({ length: last - first + 1 }, (_, i) => first + i).filter(degree => {
    const cents = degreeToPitch(tuning, degree).millicents / 1000;
    return cents >= low && cents <= high && (!context.pitchClasses?.length || context.pitchClasses.some(pc => mod(pc, period) === mod(degree, period)));
  });
  if (!allowed.length) return { notes: [], evaluation: emptyEvaluation(), candidatesEvaluated: 0, relationship: 'imitation' };
  const allowedSet = new Set(allowed), sounding = subject.map(note => soundingAt(note, context));
  const midpoint = low + (high - low) * (.28 + intent.register * .44);
  const literal: number[][] = [];
  for (let octave = Math.ceil((allowed[0] - Math.min(...source)) / period); octave <= Math.floor((allowed.at(-1)! - Math.max(...source)) / period); octave++) {
    const degrees = source.map(degree => degree + octave * period);
    if (degrees.every(degree => allowedSet.has(degree))) literal.push(degrees);
  }
  if (sounding.every(events => !events.length) && literal.length) {
    const cost = (degrees: number[]) => degrees.reduce((sum, degree) => sum + Math.abs(degreeToPitch(tuning, degree).millicents / 1000 - midpoint) / 1200, 0);
    literal.sort((a, b) => cost(a) - cost(b) || compareDegrees(a, b));
    const evaluation = { ...emptyEvaluation(), register: cost(literal[0]) / subject.length };
    for (let i = 1; i < source.length; i++) {
      const step = (source[i] - source[i - 1]) * centsPerDegree;
      const beforeStep = i < 2 ? 0 : (source[i - 1] - source[i - 2]) * centsPerDegree;
      evaluation.continuity += (Math.max(0, Math.abs(step) - 200)
        + (Math.abs(beforeStep) > 500 && Math.sign(step) === Math.sign(beforeStep) ? Math.abs(step) : 0)) / 1200 / subject.length;
    }
    evaluation.total = score(evaluation, intent);
    return { notes: subject.map((note, i) => ({ ...note, absolutePitch: degreeToPitch(tuning, literal[0][i]) })),
      evaluation, candidatesEvaluated: literal.length, relationship: 'imitation' };
  }
  const fifth = Math.round(period * Math.log2(1.5));
  const perfect = (distance: number) => { const interval = mod(Math.round(Math.abs(distance) / centsPerDegree), period); return interval === 0 || interval === fifth; };
  // Friction is measured in physical cents on every tuning. Exact octaves are
  // consonant; close doublings are charged separately to independence.
  const friction = (a: number, b: number) => {
    const folded = Math.min(mod(Math.abs(a - b), 1200), 1200 - mod(Math.abs(a - b), 1200));
    return Math.exp(-(((folded - 110) / 65) ** 2)) + .5 * Math.exp(-(((folded - 600) / 110) ** 2));
  };
  type Path = { degrees: number[]; evaluation: CounterpointEvaluation; orientation: 1 | -1 };
  let beam: Path[] = [{ degrees: [], evaluation: emptyEvaluation(), orientation: 1 }];
  if (intent.development > 0) beam.push({ degrees: [], orientation: -1,
    // Development authorizes changing orientation; fidelity still evaluates
    // every interval against the chosen source relationship below.
    evaluation: { ...emptyEvaluation(), identity: (1 - intent.development) * (1.5 + intent.fidelity) } });
  let candidatesEvaluated = 0;
  const vertical = sounding.map((events, index) => new Map(allowed.map(degree => {
    const cents = degreeToPitch(tuning, degree).millicents / 1000;
    let consonance = 0, independence = 0, weight = 0;
    for (const event of events) {
      const salience = event.overlap * (event.note.part === 'melody' ? 1.4 : event.note.part === 'bass' ? .8 : .55);
      const final = index === subject.length - 1;
      const strength = subject[index].strength;
      for (const sample of event.samples) {
        consonance += salience * sample.weight * (friction(cents, sample.cents) - intent.dissonance * (final ? .2 : .55)) ** 2
          * (final ? 1.5 : .65 + (Number.isFinite(strength) ? clamp(strength!) : 1) * .35);
        if (event.note.part === 'melody') independence += salience * sample.weight * Math.max(0, 1 - Math.abs(cents - sample.cents) / 180);
      }
      weight += salience;
    }
    return [degree, { consonance: consonance / Math.max(1, weight), independence: independence / Math.max(1, weight),
      register: Math.abs(cents - midpoint) / 1200 }];
  })));
  for (let index = 0; index < subject.length; index++) {
    const candidates: Path[] = [];
    for (const parent of beam) for (const degree of allowed) {
      const previous = parent.degrees.at(-1), step = previous === undefined ? 0 : (degree - previous) * centsPerDegree;
      const sourceStep = index ? (source[index] - source[index - 1]) * centsPerDegree * parent.orientation : 0;
      if (index && Math.abs(step) > Math.max(700, Math.abs(sourceStep) + 200)) continue;
      const e = { ...parent.evaluation }, unary = vertical[index].get(degree)!;
      e.consonance += unary.consonance; e.independence += unary.independence; e.register += unary.register;
      if (index) {
        e.identity += Math.abs(step - sourceStep) / 1200;
        e.identity += Math.abs(degree - parent.degrees[0] - (source[index] - source[0]) * parent.orientation) * centsPerDegree / 3600;
        e.continuity += Math.max(0, Math.abs(step) - 200) / 1200;
        const earlier = parent.degrees.at(-2), beforeStep = earlier === undefined ? 0 : (previous! - earlier) * centsPerDegree;
        if (Math.abs(beforeStep) > 500 && Math.sign(step) === Math.sign(beforeStep)) e.continuity += Math.abs(step) / 1200;
        const cents = degreeToPitch(tuning, degree).millicents / 1000;
        const previousCents = degreeToPitch(tuning, previous!).millicents / 1000;
        for (const other of sounding[index].filter(event => event.note.part === 'melody' || event.note.part === 'bass')) {
          const before = sounding[index - 1].find(event => event.note.voice === other.note.voice);
          if (!before) continue;
          const otherStep = other.cents - before.cents;
          if (step && otherStep && Math.sign(step) === Math.sign(otherStep)) {
            e.independence += .12 * other.overlap;
            if (perfect(cents - other.cents) && perfect(previousCents - before.cents)) e.independence += other.overlap;
          }
          if ((cents - other.cents) * (previousCents - before.cents) < 0) e.independence += .35 * other.overlap;
        }
      }
      e.total = score(e, intent); candidatesEvaluated++;
      candidates.push({ degrees: [...parent.degrees, degree], evaluation: e, orientation: parent.orientation });
    }
    // Keep both relationships alive until their motion can actually be heard.
    // An upfront transformation cost must not eliminate inversion at note one.
    beam = ([1, -1] as const).flatMap(orientation => candidates.filter(candidate => candidate.orientation === orientation)
      .sort((a, b) => a.evaluation.total - b.evaluation.total || compareDegrees(a.degrees, b.degrees)).slice(0, 12));
  }
  // A relationship is credited only when the completed pitches actually
  // carry the source's motion. An inverted search branch can still settle
  // onto a level line; that is not evidence of heard contrary development.
  const motion = (degrees: readonly number[]) => degrees.slice(1).reduce((sum, degree, index) =>
    sum + (degree - degrees[index]) * (source[index + 1] - source[index]), 0);
  const selection = context.selection;
  const planned = selection && beam.length ? choosePlannedIdea(selection.seed, selection.address, beam.map(path => ({
    id: `${path.orientation}:${path.degrees.join(',')}`, value: path,
    costs: { musical: path.evaluation.total / subject.length },
    tools: motion(path.degrees) === 0 ? [] : [motion(path.degrees) < 0 ? 'contrary development' : 'imitation'],
  })), selection.plan) : undefined;
  const winner = planned?.value ?? beam.sort((a, b) => a.evaluation.total - b.evaluation.total || b.orientation - a.orientation || compareDegrees(a.degrees, b.degrees))[0];
  if (!winner) return { notes: [], evaluation: emptyEvaluation(), candidatesEvaluated, relationship: 'imitation' };
  const evaluation = Object.fromEntries(Object.entries(winner.evaluation).map(([key, value]) => [key, value / subject.length])) as unknown as CounterpointEvaluation;
  return { notes: subject.map((note, i) => ({ ...note, absolutePitch: degreeToPitch(tuning, winner.degrees[i]) })),
    evaluation, candidatesEvaluated, relationship: motion(winner.degrees) < 0 ? 'contrary development' : 'imitation',
    ...(planned?.coverage ? { coverage: planned.coverage } : {}) };
}

/** The independent clock remembers a complete source gesture. Its evaluated
 * answer is committed at entry so later frames cannot rewrite its trajectory. */
export class CounterpointLayer {
  private readonly policy: Required<CompositionConfig>;
  private readonly period: number;
  private readonly phase: number;
  private readonly cyclesPerIdea: number;
  private readonly committed = new Map<string, CounterpointRealization>();
  private readonly entries = new Map<number, number>();
  constructor(private readonly seed: string, config: CompositionConfig, private readonly tonic: number,
    private readonly formAt: (tick: number) => FormState) {
    this.policy = normalizeComposition(config);
    const bar = this.formAt(0).barTicks ?? PPQ * 4, pulse = PPQ / 2;
    const units = Math.max(4, Math.round(bar * 2 / pulse));
    const displacement = Math.round(integer(seed, 'counter-clock', 1, Math.max(1, Math.floor(units / 2)), 'length') * this.policy.polymeter);
    this.period = Math.max(pulse * 4, (units - displacement) * pulse);
    this.phase = integer(seed, 'counter-clock', 1, Math.max(1, Math.floor(units / 2) - 1), 'pickup') * pulse;
    this.cyclesPerIdea = Math.max(1, Math.round(2 ** (1 + this.policy.repetition * 2)));
  }
  private threadAt(tick: number) {
    const cycle = Math.floor((tick - this.phase) / this.period);
    const epoch = Math.max(0, Math.floor(cycle / this.cyclesPerIdea));
    const source = this.formAt(Math.max(0, this.phase + epoch * this.cyclesPerIdea * this.period));
    const active = cycle >= 0 && random(this.seed, 'theme-response', cycle, 'enter') < this.policy.displacement * .85;
    return { cycle, epoch, source, active, start: this.phase + cycle * this.period };
  }
  snapshot(tick: number, tuning = this.formAt(tick).tuning ?? '12tet', voice = 8): IndependentLayerSnapshot {
    const thread = this.threadAt(tick);
    const committed = this.committed.get(`${voice}:${thread.cycle}:${tuning}`);
    return { id: voice === 8 ? 'independent-answer' : `independent-answer:voice-${voice}`, role: 'counter', sourceId: `${thread.source.themeId}:head:epoch-${thread.epoch}`,
      label: `Theme response · ${this.period / (PPQ / 2)}/8 cycle`, cycleTicks: this.period,
      cycleStartTick: thread.start, cycleEndTick: thread.start + this.period, active: thread.active,
      ...(committed ? { evaluation: { ...committed.evaluation }, candidatesEvaluated: committed.candidatesEvaluated,
        relationship: committed.relationship,
        ...(committed.coverage ? { coverage: structuredClone(committed.coverage) } : {}) } : {}) };
  }
  notes(tick: number, duration: number, p: Parameters, tuning: TuningId, textureAt?: TextureAt,
    thematic?: ThemeCoreSnapshot, context?: CounterpointContext): NoteEvent[] {
    if (this.policy.displacement <= 0 || p.melodicActivity < .12 || duration <= 0) return [];
    const notes: NoteEvent[] = [], period = TUNINGS[tuning].divisions;
    const firstCycle = Math.floor((tick - this.phase) / this.period);
    for (let cycle = firstCycle; this.phase + cycle * this.period < tick + duration; cycle++) {
      if (cycle < 0) continue;
      const thread = this.threadAt(this.phase + cycle * this.period), start = thread.start;
      const pace = textureAt?.(Math.max(0, start)).pace ?? Math.max(.5, p.melodicActivity);
      if (pace < .38 || !thread.active) continue;
      const third = themeThird(this.seed, thread.source.themeId);
      const core = composeThemeCore(this.seed, thread.source.themeId, third), field = lyricalField(tuning, third);
      const head = core.clauses[0].notes;
      if (!head.length) continue;
      const span = head.reduce((sum, note) => sum + note.rhythmUnits * (PPQ / 2), 0);
      // Binary diminution preserves the source's subdivision ancestry.
      const scale = 2 ** Math.min(0, Math.floor(Math.log2((this.period - PPQ / 4) / span)));
      const root = pitchToDegree(tuning, { millicents: Math.round((6000 + this.tonic * 100 + (thread.source.tonalOffsetCents ?? 0)) * 1000) });
      let elapsed = 0;
      const subject: CounterpointSubjectNote[] = head.map((source, index) => {
        const onset = start + Math.round(elapsed * scale);
        elapsed += source.rhythmUnits * (PPQ / 2);
        const next = start + Math.round(elapsed * scale), slot = next - onset;
        return { sourceId: source.id, tick: onset, duration: Math.max(1, slot - Math.min(30, Math.floor(slot / 8))),
          absolutePitch: degreeToPitch(tuning, root + field[mod(source.degree, field.length)] + Math.floor(source.degree / field.length) * period),
          strength: core.cell?.attacks[index]?.strength ?? (index === 0 ? 1 : .7) };
      });
      if (!subject.some(note => note.tick >= tick && note.tick < tick + duration)) continue;
      const voice = context?.voice ?? 8, key = `${voice}:${cycle}:${tuning}`, cached = this.committed.get(key);
      const entry = this.entries.get(voice) ?? 0;
      const foreground: NoteEvent[] = (thematic?.notes ?? []).map(note => ({ id: `counter-preview:${note.id}`, tick: note.startTick,
        duration: note.endTick - note.startTick, absolutePitch: { millicents: Math.round(note.absolutePitchCents * 1000) },
        velocity: .5, part: 'melody', voice: 5 }));
      const realization = cached ?? composeCounterpoint(subject, tuning, {
        fidelity: p.melodicFamiliarity, smoothness: p.voiceLeading, independence: this.policy.displacement,
        dissonance: p.dissonance, development: this.policy.development * p.motifTransformation, register: p.brightness,
      }, { ...context, foreground: context?.foreground ?? foreground, pitchClasses: context?.pitchClasses ?? field.map(degree => mod(root + degree, period)),
        selection: context?.selection ?? { seed: this.seed, address: `counter:${voice}:${cycle}`,
          plan: { scope: `counterpoint:voice-${voice}`, ordinal: context || thematic ? entry : cycle, vocabulary: COUNTERPOINT_TOOLS,
            maxRegret: this.policy.development * p.motifTransformation * .85 } } });
      if (!cached && (context || thematic)) {
        if (this.committed.size >= 128) this.committed.delete(this.committed.keys().next().value!);
        this.committed.set(key, realization);
        // Silent clock cycles, cached reads and snapshot/lookahead queries
        // cannot consume a vocabulary opportunity. Each actual committed
        // entrance advances its voice, even when entrances are periodic.
        if (!this.entries.has(voice) && this.entries.size >= 128) this.entries.delete(this.entries.keys().next().value!);
        this.entries.set(voice, entry + 1);
      }
      for (let index = 0; index < realization.notes.length; index++) {
        const note = realization.notes[index];
        if (note.tick < tick || note.tick >= tick + duration) continue;
        const actual = textureAt?.(note.tick), voice = context?.voice ?? 8;
        notes.push({ id: `counter:${cycle}:${index}${voice === 8 ? '' : `:voice-${voice}`}`, tick: note.tick, duration: note.duration, absolutePitch: { ...note.absolutePitch },
          ...(tuning === '12tet' ? { midiNote: pitchToMidi(note.absolutePitch) } : {}),
          velocity: Math.round(Math.min(actual?.velocityCeiling ?? .8, (.27 + p.dynamics * .18) * (index === 0 ? 1 : .86)) * 1e6) / 1e6,
          part: 'melody', voice, timbre: pace < .68 ? 'strings' : 'reed', articulation: 'connected',
          expression: { role: 'layer', sourceId: note.sourceId } });
      }
    }
    return notes;
  }
}
