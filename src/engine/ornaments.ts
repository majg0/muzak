import type { Parameters } from '../types';
import { random } from './random';
import { periodicField } from './periodic-field';
import { choosePlannedIdea, type IdeaPlan, type PlannedIdea, type ToolCoverage } from './idea-selection';

export interface OrnamentCore {
  tick: number; duration: number; cents: number; accent: number; landing: boolean; sourceId?: string;
  role?: 'head' | 'continuation' | 'apex' | 'approach' | 'cadence';
}
export interface OrnamentNote extends OrnamentCore {
  landing: false; core: false; sourceId: string;
  endCents?: number; glideTicks?: number;
  articulation?: 'sustained' | 'connected' | 'detached';
}
export interface OrnamentPlan {
  notes: OrnamentNote[]; coreDurations: number[]; kinds: string[];
  decisions?: Array<{ index: number; kind: OrnamentKind; costs: Readonly<Record<string, number>>;
    candidatesEvaluated: number; coverage?: ToolCoverage }>;
}
export interface OrnamentInput {
  seed: string; occurrenceId: string; sourceId: string; core: readonly OrnamentCore[];
  endTick: number; subdivisionTicks: number; parameters: Parameters; amount: number; variation: number; energy?: number;
  /** One octave of scale locations, in physical cents from the local tonic.
   * The caller supplies its actual native field, including24/31-EDO. */
  native?: { fieldCents: readonly number[]; chromaticStepCents: number };
  allowGlides?: boolean;
  /** Remaining attacks and physical register are feasibility constraints,
   * applied before comparing complete figures. */
  noteBudget?: number;
  pitchInRange?: (relativeCents: number) => boolean;
  plan?: IdeaPlan;
}
const unit = (value: number) => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
export const ORNAMENT_KINDS = ['grace-approach', 'upper-mordent', 'lower-mordent', 'trill', 'turn', 'enclosure',
  'passing-chain', 'accented-repetition', 'anticipation', 'neighbor-return', 'connected-slide', 'revolving-approach'] as const;
export type OrnamentKind = typeof ORNAMENT_KINDS[number];

function pitchContext(input: OrnamentInput) {
  const { at, indexAt } = periodicField(input.native?.fieldCents ?? [0, 200, 400, 500, 700, 900, 1100]);
  const chromatic = input.native?.chromaticStepCents ?? 100;
  if (!Number.isFinite(chromatic) || chromatic <= 0 || chromatic > 1200) throw new RangeError('An ornament needs a finite native pitch step.');
  return { at, indexAt, neighbor: (cents: number, offset: number) => at(indexAt(cents) + offset),
    chromatic: (cents: number, offset: number) => (Math.round(cents / chromatic) + offset) * chromatic };
}

/** Written decorations connect existing structural tones. Core onsets, pitches
 * and source identities are never moved; only their sounding durations may be
 * trimmed to make a place for the figure. Cents remain physical relative cents
 * until the phrase layer projects the complete line onto its native tuning. */
export function planOrnaments(input: OrnamentInput): OrnamentPlan {
  const { seed, occurrenceId, sourceId, core, endTick, subdivisionTicks, parameters: p } = input;
  if (!Number.isSafeInteger(endTick) || !Number.isSafeInteger(subdivisionTicks) || subdivisionTicks <= 0) throw new RangeError('Ornaments need integer musical boundaries and subdivisions.');
  const result: OrnamentPlan = { notes: [], coreDurations: core.map(note => note.duration), kinds: [] };
  const amount = unit(input.amount), variation = unit(input.variation);
  if (!amount || core.length < 2) return result;
  if (input.noteBudget !== undefined && (!Number.isSafeInteger(input.noteBudget) || input.noteBudget < 0))
    throw new RangeError('An ornament attack budget must be a nonnegative integer.');
  if (core.some(note => !Number.isSafeInteger(note.tick) || !Number.isSafeInteger(note.duration) || note.duration <= 0
    || !Number.isSafeInteger(note.tick + note.duration) || !Number.isFinite(note.cents) || !Number.isFinite(note.accent)))
    throw new RangeError('Ornaments need finite pitches and positive integer core durations.');
  const energy = unit(input.energy ?? p.dynamics * .4 + p.tension * .3 + p.melodicActivity * .3);
  const pitch = pitchContext(input);
  const step = Math.max(30, Math.round(subdivisionTicks / (energy > .7 && amount > .6 ? 2 : 1)));
  const maxDecorated = Math.max(1, Math.ceil((core.length - 1) * amount * (.45 + energy * .45)));
  let decorated = 0;
  // A limited decoration budget is distributed across the whole argument,
  // including its approach. Taking the first N gaps starved later cadences.
  const opportunities = Array.from({ length: core.length - 1 }, (_, index) => index).sort((a, b) =>
    random(seed, 'ornament-priority', occurrenceId, sourceId, a) - random(seed, 'ornament-priority', occurrenceId, sourceId, b) || a - b);
  for (const index of opportunities) {
    if (decorated >= maxDecorated) break;
    const remaining = input.noteBudget === undefined ? Infinity : input.noteBudget - result.notes.length;
    if (remaining <= 0) break;
    const left = core[index], right = core[index + 1];
    const availableEnd = Math.min(right.tick, endTick, left.tick + left.duration);
    const gap = availableEnd - left.tick;
    if (gap < step * 4 || left.landing || ['head', 'apex', 'cadence'].includes(left.role ?? '')
      || random(seed, 'ornament-opportunity', occurrenceId, sourceId, index) >= amount * (.65 + variation * .35)) continue;
    const distance = Math.abs(pitch.indexAt(right.cents) - pitch.indexAt(left.cents));
    // Choose a figure that has a musical job in this particular gap. Long
    // repeated notes admit trills; wider links admit scalar motion; cadence
    // approaches favor anticipation/enclosure. A slide requires explicit
    // audible pitch-ramp support from the production caller.
    const kinds = ORNAMENT_KINDS.filter(kind => {
      if (kind === 'connected-slide') return input.allowGlides && distance > 0 && distance <= 4;
      if (kind === 'trill') return energy > .5 && gap >= step * 7 && distance <= 2;
      if (kind === 'passing-chain') return distance >= 2 && distance <= 8;
      if (kind === 'accented-repetition') return energy > .48;
      if (kind === 'anticipation') return right.tick - availableEnd <= step && right.landing;
      if (kind === 'revolving-approach') return energy > .6 && distance <= 4;
      return true;
    });
    const room = Math.floor(gap / step) - 2;
    const direction = Math.sign(right.cents - left.cents) || (random(seed, 'ornament-direction', sourceId, index) < .5 ? 1 : -1);
    const candidates: PlannedIdea<{ kind: OrnamentKind; notes: OrnamentNote[]; coreDuration: number }>[] = [];
    for (const kind of kinds) {
      let values: number[];
      switch (kind) {
        case 'grace-approach': values = [pitch.neighbor(right.cents, -direction)]; break;
        case 'upper-mordent': values = [pitch.neighbor(left.cents, 1), left.cents]; break;
        case 'lower-mordent': values = [pitch.neighbor(left.cents, -1), left.cents]; break;
        case 'turn': values = [pitch.neighbor(right.cents, 2), pitch.neighbor(right.cents, 1), pitch.neighbor(right.cents, -1)]; break;
        case 'enclosure': {
          const neighbor = p.chromaticism > .3 ? pitch.chromatic : pitch.neighbor;
          values = [neighbor(right.cents, -direction * 2), neighbor(right.cents, direction), neighbor(right.cents, -direction)]; break;
        }
        case 'trill': values = Array.from({ length: energy > .8 && Math.min(room, remaining) >= 6 ? 6 : 4 }, (_, i) => i % 2 ? left.cents : pitch.neighbor(left.cents, 1)); break;
        case 'neighbor-return': values = [pitch.neighbor(left.cents, direction), pitch.neighbor(left.cents, direction * 2), pitch.neighbor(left.cents, direction), left.cents]; break;
        case 'anticipation': values = [pitch.neighbor(right.cents, -direction), right.cents]; break;
        case 'connected-slide': values = [left.cents]; break;
        case 'revolving-approach': values = [pitch.neighbor(right.cents, -direction * 2), pitch.neighbor(right.cents, -direction),
          pitch.neighbor(right.cents, direction), pitch.neighbor(right.cents, -direction)]; break;
        case 'passing-chain': {
          const from = pitch.indexAt(left.cents), until = pitch.indexAt(right.cents), count = Math.min(energy > .7 ? 6 : 4, Math.abs(until - from) - 1);
          values = Array.from({ length: count }, (_, i) => pitch.at(from + direction * (i + 1)));
          break;
        }
        case 'accented-repetition': values = Array.from({ length: energy > .65 && Math.min(room, remaining) >= 4 ? 4 : 2 }, () => left.cents); break;
      }
      // A named contour is indivisible: dropping its first or last notes would
      // credit a tool that was never actually heard. Shorter complete figures
      // remain available when this one cannot fit.
      if (!values.length || values.length > room || values.length > remaining) continue;
      // Mordents answer the attacked source immediately. Longer connective
      // figures approach the next structural note; the source keeps its body.
      const early = kind.includes('mordent') || kind === 'accented-repetition' || kind === 'trill' || kind === 'neighbor-return';
      const onset = early ? left.tick + step : kind === 'connected-slide' ? left.tick + Math.round(gap * .55) : availableEnd - values.length * step;
      const coreDuration = Math.min(left.duration, Math.max(1, onset - left.tick + Math.round(step * .07)));
      const notes: OrnamentNote[] = values.map((cents, ordinal) => {
        const tick = onset + ordinal * step;
        const next = ordinal === values.length - 1 ? availableEnd : tick + step;
        const repeated = kind === 'accented-repetition';
        const duration = Math.max(1, Math.min(availableEnd - tick, repeated ? Math.round(step * .58)
          : kind === 'connected-slide' ? availableEnd - tick
            : ordinal === values.length - 1 && early ? Math.max(step, next - tick - Math.round(step * .18)) : Math.round(step * 1.07)));
        const accent = Math.min(left.accent * .86, .48 + energy * .18 + (repeated && ordinal % 2 === 0 ? .12 : 0));
        return { tick, duration, cents, accent, landing: false, core: false,
          articulation: repeated ? 'detached' : 'connected',
          ...(kind === 'connected-slide' ? { endCents: right.cents, glideTicks: duration } : {}),
          sourceId: `${sourceId}:ornament:${kind}:${index}:${ordinal}` };
      });
      const validPitch = (cents: number) => Number.isFinite(cents)
        // Written source tones already use integer millicents. Compare in that
        // same representation; a floating-point degree epsilon would reject
        // valid19/31-EDO repetitions and slide endpoints after source rounding.
        && (!input.native || Math.round(cents * 1000) === Math.round(Math.round(cents / input.native.chromaticStepCents)
          * input.native.chromaticStepCents * 1000))
        && (!input.pitchInRange || input.pitchInRange(cents));
      if (notes.some(note => !Number.isSafeInteger(note.tick) || !Number.isSafeInteger(note.duration)
        || note.duration <= 0 || note.tick <= left.tick || note.tick + note.duration > availableEnd
        || !validPitch(note.cents) || note.endCents !== undefined && !validPitch(note.endCents))) continue;
      const path = [left.cents, ...values, ...(kind === 'connected-slide' ? [right.cents] : [])];
      const intervals = path.slice(1).map((value, ordinal) => value - path[ordinal]);
      const arrival = path.at(-1)!;
      const repeated = intervals.filter(interval => interval === 0).length / intervals.length;
      const travel = intervals.reduce((sum, interval) => sum + Math.abs(interval), 0);
      const costs = {
        continuity: intervals.reduce((sum, interval) => sum + Math.max(0, Math.abs(interval) - 200), 0) / intervals.length / 1200 * .3,
        destination: Math.abs(right.cents - arrival) / 1200 * (right.landing ? .65 : .4),
        repetition: repeated * (1 - energy) * .4,
        function: Math.max(0, travel - Math.abs(arrival - left.cents)) / 2400 * .25,
        activity: Math.abs(values.length - (1 + energy * amount * 3)) / 4 * .18,
      };
      candidates.push({ id: kind, tools: [kind], costs, value: { kind, notes, coreDuration } });
    }
    if (!candidates.length) continue;
    const chosen = choosePlannedIdea(seed, `ornament:${occurrenceId}:${sourceId}:${index}`, candidates, input.plan);
    result.coreDurations[index] = chosen.value.coreDuration;
    result.notes.push(...chosen.value.notes);
    (result.decisions ??= []).push({ index, kind: chosen.value.kind, costs: chosen.costs,
      candidatesEvaluated: chosen.candidates, ...(chosen.coverage ? { coverage: chosen.coverage } : {}) });
    decorated++; result.kinds.push(chosen.value.kind);
  }
  result.notes.sort((a, b) => a.tick - b.tick || (a.sourceId < b.sourceId ? -1 : a.sourceId > b.sourceId ? 1 : 0));
  return result;
}
