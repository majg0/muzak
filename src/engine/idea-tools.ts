import { choosePlannedIdea, type IdeaPlan, type ToolCoverage } from './idea-selection';

export interface GestureNote { degree: number; units: number; strength: number; }
export type GestureOperation =
  | { kind: 'transpose'; degrees: number }
  | { kind: 'invert'; axis?: number }
  | { kind: 'retrograde' }
  | { kind: 'fragment'; start: number; count: number }
  | { kind: 'interval-scale'; factor: number }
  | { kind: 'time-scale'; factor: number }
  | { kind: 'extend'; count: number }
  | { kind: 'connect'; target: number; count: number; arrivalStep?: number }
  | { kind: 'arpeggiate'; target: number; count: number; pitchClasses: readonly number[]; period?: number }
  | { kind: 'pedal'; degree: number; count: number };
export interface Gesture {
  sourceId: string;
  notes: readonly GestureNote[];
  operations: readonly GestureOperation[];
}
export interface GestureContext {
  from: number; target: number; count: number; development: number; familiarity: number; closing: boolean;
  pitchClasses?: readonly number[]; maximumLeap?: number;
  /** Desired duration relative to the resized source; when supplied, this
   * also bounds the parent time available to the gesture. */
  durationRatio?: number;
  /** Absolute source durations may scale. A fixed-span performance interprets
   * proportional rhythm only, so a uniform scale cannot claim an audible edit. */
  durationMode?: 'absolute' | 'relative';
  plan?: IdeaPlan;
}
export interface GestureProposal { id: string; gesture: Gesture; }
export interface GestureDecision extends GestureProposal {
  costs: Readonly<Record<string, number>>; candidateCount: number;
  tools: readonly string[]; coverage?: ToolCoverage;
}
export const GESTURE_OPERATIONS: Readonly<Record<GestureOperation['kind'], string>> = Object.freeze({
  transpose: 'Move every degree by the same interval.',
  invert: 'Reflect the interval relationships around a declared axis.',
  retrograde: 'Reverse the complete ordered pitch, duration and accent gesture.',
  fragment: 'Recall a contiguous portion of the source.',
  'interval-scale': 'Contract or expand intervals around the first degree.',
  'time-scale': 'Augment or diminish all durations proportionally.',
  extend: 'Continue the last interval without cycling through the source.',
  connect: 'Move in one direction from the opening degree to a destination.',
  arpeggiate: 'Follow a declared pitch collection in one direction to its destination.',
  pedal: 'Hold one structural degree while retaining the source accent relationships.',
});

const LIMIT = 128, LOW = -7, HIGH = 12;
const mod = (value: number, period: number) => ((value % period) + period) % period;
const unit = (value: number) => Math.max(0, Math.min(1, value));
const finite = (value: number, label: string) => {
  if (!Number.isFinite(value)) throw new RangeError(`${label} must be finite.`);
  return value;
};
const integer = (value: number, label: string, low = Number.MIN_SAFE_INTEGER, high = Number.MAX_SAFE_INTEGER) => {
  if (!Number.isSafeInteger(value) || value < low || value > high) throw new RangeError(`${label} must be an integer in its allowed range.`);
  return value;
};
function validateNotes(notes: readonly GestureNote[]): void {
  if (!notes.length || notes.length > LIMIT) throw new RangeError('A gesture needs between 1 and 128 notes.');
  for (const note of notes) {
    integer(note.degree, 'Gesture degree');
    if (!Number.isFinite(note.units) || note.units <= 0 || note.units > Number.MAX_SAFE_INTEGER)
      throw new RangeError('Gesture durations must be positive finite weights.');
    if (!Number.isFinite(note.strength) || note.strength < 0 || note.strength > 1)
      throw new RangeError('Gesture strengths must be between zero and one.');
  }
  if (!Number.isFinite(notes.reduce((sum, note) => sum + note.units, 0))) throw new RangeError('Gesture duration overflow.');
}
function validateSource(source: Gesture): void {
  if (!source.sourceId || !Array.isArray(source.operations)) throw new RangeError('A gesture needs source lineage and operation history.');
  validateNotes(source.notes);
}
/** Stretch the source's ordering over a new cardinality, without modulo
 * indexing. A larger gesture does not imply more repetitions of a tiny cell. */
function rhythmAt(notes: readonly GestureNote[], index: number, count: number): GestureNote {
  return notes[count === 1 ? notes.length - 1 : Math.round(index * (notes.length - 1) / (count - 1))];
}

/** Ordered algebra over musical relationships. Each operation retains source
 * identity and writes its own provenance; caller-owned objects are never changed.
 * Extend counts additional notes. Connect/arpeggiate/pedal counts are totals. */
export function transformGesture(source: Gesture, operations: readonly GestureOperation[]): Gesture {
  validateSource(source);
  let notes = source.notes.map(note => ({ ...note }));
  for (const operation of operations) {
    const first = notes[0].degree;
    switch (operation.kind) {
      case 'transpose': {
        const delta = integer(operation.degrees, 'Transposition');
        notes = notes.map(note => ({ ...note, degree: note.degree + delta })); break;
      }
      case 'invert': {
        const axis = finite(operation.axis ?? first, 'Inversion axis');
        notes = notes.map(note => ({ ...note, degree: Math.round(axis * 2 - note.degree) })); break;
      }
      case 'retrograde': notes.reverse(); break;
      case 'fragment': {
        const start = integer(operation.start, 'Fragment start', 0, notes.length - 1);
        const count = integer(operation.count, 'Fragment count', 1, LIMIT);
        notes = notes.slice(start, start + count); break;
      }
      case 'interval-scale': {
        const factor = finite(operation.factor, 'Interval scale');
        notes = notes.map(note => ({ ...note, degree: first + Math.round((note.degree - first) * factor) })); break;
      }
      case 'time-scale': {
        const factor = finite(operation.factor, 'Time scale');
        if (factor <= 0) throw new RangeError('Time scale must be positive.');
        notes = notes.map(note => ({ ...note, units: note.units * factor })); break;
      }
      case 'extend': {
        const count = integer(operation.count, 'Extension count', 1, LIMIT - notes.length);
        const last = notes.at(-1)!, step = notes.length > 1 ? last.degree - notes.at(-2)!.degree : 0;
        notes.push(...Array.from({ length: count }, (_, index) => ({ ...last, degree: last.degree + step * (index + 1) }))); break;
      }
      case 'connect': {
        const target = integer(operation.target, 'Connection target'), count = integer(operation.count, 'Connection count', 1, LIMIT);
        const arrival = operation.arrivalStep === undefined ? undefined : integer(operation.arrivalStep, 'Arrival step', 0, 7);
        const approach = target - Math.sign(target - first) * Math.min(Math.abs(target - first), arrival ?? 0);
        notes = Array.from({ length: count }, (_, index) => ({ ...rhythmAt(notes, index, count), degree:
          arrival === undefined || count === 1 ? first + Math.round((target - first) * ((index + 1) / count))
            : index === count - 1 ? target : first + Math.round((approach - first) * ((index + 1) / (count - 1))) })); break;
      }
      case 'arpeggiate': {
        const target = integer(operation.target, 'Arpeggio target'), count = integer(operation.count, 'Arpeggio count', 1, LIMIT);
        const period = integer(operation.period ?? 7, 'Arpeggio period', 1, LIMIT);
        if (!operation.pitchClasses.length || operation.pitchClasses.length > LIMIT) throw new RangeError('An arpeggio needs a bounded pitch collection.');
        const classes = new Set(operation.pitchClasses.map(degree => mod(integer(degree, 'Arpeggio pitch class'), period)));
        if (!classes.has(mod(target, period))) throw new RangeError('An arpeggio target must belong to its pitch collection.');
        const low = Math.min(first, target), high = Math.max(first, target);
        if (high - low > LIMIT * period) throw new RangeError('An arpeggio needs a bounded degree span.');
        const field = Array.from({ length: high - low + 1 }, (_, index) => low + index).filter(degree => classes.has(mod(degree, period)));
        let previous = first;
        notes = Array.from({ length: count }, (_, index) => {
          const desired = first + (target - first) * ((index + 1) / count);
          const eligible = field.filter(degree => target >= first ? degree >= previous : degree <= previous);
          const degree = index === count - 1 ? target : eligible.reduce((best, value) =>
            Math.abs(value - desired) < Math.abs(best - desired) ? value : best, target);
          previous = degree;
          return { ...rhythmAt(notes, index, count), degree };
        }); break;
      }
      case 'pedal': {
        const degree = integer(operation.degree, 'Pedal degree'), count = integer(operation.count, 'Pedal count', 1, LIMIT);
        notes = Array.from({ length: count }, (_, index) => ({ ...rhythmAt(notes, index, count), degree })); break;
      }
      default: throw new RangeError('Unknown gesture operation.');
    }
    validateNotes(notes);
  }
  return { sourceId: source.sourceId, notes, operations: structuredClone([...source.operations, ...operations]) };
}

type NormalizedContext = Required<Omit<GestureContext, 'durationRatio' | 'plan'>> & Pick<GestureContext, 'durationRatio' | 'plan'>;
function normalizeContext(context: GestureContext): NormalizedContext {
  integer(context.from, 'Incoming degree', LOW, HIGH); integer(context.target, 'Destination degree', LOW, HIGH);
  integer(context.count, 'Gesture count', 1, LIMIT);
  const maximumLeap = integer(context.maximumLeap ?? 7, 'Maximum leap', 1, 7);
  const reach = context.closing && context.count >= 2 ? (context.count - 1) * maximumLeap + 1 : context.count * maximumLeap;
  if (Math.abs(context.target - context.from) > reach) throw new RangeError('The gesture cannot reach its destination within the leap budget.');
  if (context.durationRatio !== undefined && (!Number.isFinite(context.durationRatio) || context.durationRatio <= 0))
    throw new RangeError('A duration ratio must be positive and finite.');
  const pitchClasses = context.pitchClasses ?? [0, 2, 4];
  if (!pitchClasses.length || pitchClasses.length > LIMIT) throw new RangeError('A gesture needs a bounded pitch collection.');
  pitchClasses.forEach(degree => integer(degree, 'Gesture pitch class'));
  if (context.durationMode !== undefined && !['absolute', 'relative'].includes(context.durationMode))
    throw new RangeError('Unknown gesture duration mode.');
  return { ...context, durationMode: context.durationMode ?? 'absolute', development: unit(finite(context.development, 'Development')), familiarity: unit(finite(context.familiarity, 'Familiarity')),
    pitchClasses: [...pitchClasses], maximumLeap };
}
function resized(source: Gesture, count: number): Gesture {
  return transformGesture(source, count < source.notes.length ? [{ kind: 'fragment', start: 0, count }]
    : count > source.notes.length ? [{ kind: 'extend', count: count - source.notes.length }] : []);
}

/** Credit audible operations, not identity transforms or a duration scale
 * subsequently cancelled by another scale in the same chain. */
export function gestureTools(source: Gesture, result: Gesture): string[] {
  if (sameNotes(source.notes, result.notes)) return [];
  let current = source, durationScale = 1;
  const used = new Set<string>();
  for (const operation of result.operations.slice(source.operations.length)) {
    const next = transformGesture(current, [operation]);
    if (next.notes.length !== current.notes.length || next.notes.some((note, i) =>
      note.degree !== current.notes[i].degree || note.units !== current.notes[i].units || note.strength !== current.notes[i].strength))
      used.add(operation.kind);
    if (operation.kind === 'time-scale') durationScale *= operation.factor;
    current = next;
  }
  if (Math.abs(durationScale - 1) < 1e-10) used.delete('time-scale');
  const operations = result.operations.slice(source.operations.length);
  for (const tool of used) if (operations.filter(operation => operation.kind === tool).length > 1) {
    try {
      if (sameNotes(transformGesture(source, operations.filter(operation => operation.kind !== tool)).notes, result.notes)) used.delete(tool);
    } catch (error) {
      // Removing a structural operation can invalidate a later fragment; in
      // that case it is a necessary part of this otherwise valid chain.
      if (!(error instanceof RangeError)) throw error;
    }
  }
  return [...used].sort();
}
const sameNotes = (a: readonly GestureNote[], b: readonly GestureNote[]) => a.length === b.length
  && a.every((note, index) => note.degree === b[index].degree && Math.abs(note.units - b[index].units) < 1e-10
    && note.strength === b[index].strength);

/** Equivalent sounds compete once, with their simplest operation chain.
 * An algebraic identity cannot earn novelty by spelling itself elaborately. */
function distinctGestures(proposals: GestureProposal[], relative: boolean): GestureProposal[] {
  const unique = new Map<string, GestureProposal>();
  for (const proposal of proposals) {
    const units = relative ? proposal.gesture.notes.reduce((sum, note) => sum + note.units, 0) : 1;
    const signature = JSON.stringify(proposal.gesture.notes.map(note => [note.degree,
      Math.round(note.units / units * 1e10) / 1e10, note.strength]));
    const previous = unique.get(signature);
    if (!previous || proposal.gesture.operations.length < previous.gesture.operations.length
      || proposal.gesture.operations.length === previous.gesture.operations.length && proposal.id < previous.id)
      unique.set(signature, proposal);
  }
  return [...unique.values()];
}
function feasible(gesture: Gesture, context: NormalizedContext): boolean {
  if (gesture.notes.length !== context.count || gesture.notes.at(-1)!.degree !== context.target) return false;
  if (context.closing && gesture.notes.length >= 2 && Math.abs(gesture.notes.at(-2)!.degree - context.target) > 1) return false;
  let previous = context.from;
  for (const note of gesture.notes) {
    if (note.degree < LOW || note.degree > HIGH || Math.abs(note.degree - previous) > context.maximumLeap) return false;
    if (context.closing && (Math.abs(context.target - note.degree) > Math.abs(context.target - previous)
      || note.degree < Math.min(context.from, context.target) || note.degree > Math.max(context.from, context.target))) return false;
    previous = note.degree;
  }
  return true;
}

/** A compact vocabulary of composable operations, not prewritten tunes. Every
 * proposal has its requested cardinality, target, register and leap budget. */
export function proposeGestures(source: Gesture, requested: GestureContext): GestureProposal[] {
  validateSource(source);
  const context = normalizeContext(requested), proposals: GestureProposal[] = [];
  const add = (id: string, operations: GestureOperation[], align = true) => {
    let gesture = resized(transformGesture(source, operations), context.count);
    if (align) gesture = transformGesture(gesture, [{ kind: 'transpose', degrees: context.target - gesture.notes.at(-1)!.degree }]);
    if (feasible(gesture, context)) proposals.push({ id, gesture });
  };
  const transformations: Array<[string, GestureOperation[]]> = [
    ['sequence', []], ['inversion', [{ kind: 'invert' }]], ['retrograde', [{ kind: 'retrograde' }]],
    ['retrograde-inversion', [{ kind: 'retrograde' }, { kind: 'invert' }]],
    ['contraction', [{ kind: 'interval-scale', factor: .5 }]],
    ['expansion', [{ kind: 'interval-scale', factor: 1 + context.development }]],
  ];
  for (const [id, operations] of transformations) add(id, operations);
  for (let start = 1; start < Math.min(source.notes.length, 4); start++) {
    add(`fragment-${start}`, [{ kind: 'fragment', start, count: Math.min(context.count, source.notes.length - start) }]);
  }
  const entry: GestureOperation[] = [{ kind: 'transpose', degrees: context.from - source.notes[0].degree }];
  add('connection', [...entry, { kind: 'connect', target: context.target, count: context.count,
    ...(context.closing ? { arrivalStep: 1 } : {}) }], false);
  if (context.pitchClasses.some(degree => mod(degree, 7) === mod(context.target, 7)))
    add('arpeggio', [...entry, { kind: 'arpeggiate', target: context.target, count: context.count, pitchClasses: context.pitchClasses }], false);
  add('pedal', [{ kind: 'pedal', degree: context.target, count: context.count }], false);
  if (context.durationMode === 'relative') return distinctGestures(proposals, true);
  const referenceUnits = resized(source, context.count).notes.reduce((sum, note) => sum + note.units, 0);
  const budget = context.durationRatio === undefined ? undefined : referenceUnits * context.durationRatio;
  if (budget !== undefined && (!Number.isFinite(budget) || budget <= 0)) throw new RangeError('Parent duration budget is out of range.');
  return distinctGestures(proposals.flatMap(proposal => {
    const variants = [proposal, ...([{ label: 'augmentation', factor: 2 }, { label: 'diminution', factor: .5 }]).map(variant => ({
      id: `${proposal.id}:${variant.label}`, gesture: transformGesture(proposal.gesture, [{ kind: 'time-scale', factor: variant.factor }]),
    }))];
    const duration = proposal.gesture.notes.reduce((sum, note) => sum + note.units, 0);
    if (budget !== undefined && !variants.some(variant => Math.abs(variant.gesture.notes.reduce((sum, note) => sum + note.units, 0) / budget - 1) < 1e-10))
      variants.push({ id: `${proposal.id}:fit-duration`, gesture: transformGesture(proposal.gesture, [{ kind: 'time-scale', factor: budget / duration }]) });
    return variants.filter(variant => budget === undefined || variant.gesture.notes.reduce((sum, note) => sum + note.units, 0) <= budget * (1 + 1e-10));
  }), false);
}

/** Shared whole-gesture evaluation. Familiarity protects intervals and rhythm;
 * development admits departure only when continuity, function and direction
 * still make the result coherent. All selection happens after feasibility. */
export function chooseGesture(seed: string, address: string, source: Gesture, requested: GestureContext): GestureDecision {
  const context = normalizeContext(requested), reference = resized(source, context.count);
  const sourceUnits = reference.notes.reduce((sum, note) => sum + note.units, 0);
  const sourceUnisons = reference.notes.slice(1).filter((note, index) => note.degree === reference.notes[index].degree).length;
  const candidates = proposeGestures(source, context).map(proposal => {
    const notes = proposal.gesture.notes, units = notes.reduce((sum, note) => sum + note.units, 0);
    let distortion = 0, rhythmic = 0, continuity = 0, reversals = 0, stability = 0, lastStep = 0;
    for (let i = 0; i < notes.length; i++) {
      const step = notes[i].degree - (notes[i - 1]?.degree ?? context.from);
      if (i) {
        const original = reference.notes[i].degree - reference.notes[i - 1].degree;
        distortion += Math.abs(step - original) / 7;
        if (step && lastStep && Math.sign(step) !== Math.sign(lastStep)) reversals += .3;
        if (i >= 2 && notes[i].degree === notes[i - 2].degree && step) reversals += .7;
      }
      if (step) lastStep = step;
      continuity += Math.max(0, Math.abs(step) - 2) ** 2 / context.maximumLeap ** 2 * (i ? .25 : 1);
      rhythmic += Math.abs(notes[i].units / units - reference.notes[i].units / sourceUnits);
      if (!context.pitchClasses.some(degree => mod(degree, 7) === mod(notes[i].degree, 7))) stability += notes[i].strength * .15;
    }
    distortion /= Math.max(1, notes.length - 1);
    const unisons = notes.slice(1).filter((note, index) => note.degree === notes[index].degree).length;
    const actualDeparture = unit(distortion + rhythmic * .5);
    const desiredDeparture = context.development * (1 - context.familiarity * .85);
    const costs = {
      identity: distortion * (.6 + context.familiarity * 6) * (1 - context.development * (1 - context.familiarity) * .7)
        + rhythmic * (.3 + context.familiarity * 2),
      continuity: continuity / notes.length,
      destination: Math.abs(notes.at(-1)!.degree - context.target),
      range: notes.some(note => note.degree < LOW || note.degree > HIGH) ? Infinity : 0,
      reversals: reversals / Math.max(1, notes.length - 2),
      accent: stability / notes.length,
      departure: Math.abs(actualDeparture - desiredDeparture) * (.65 + context.development * (1 - context.familiarity) * 2),
      duration: context.durationMode === 'relative' ? 0 : Math.abs(Math.log2(units / (sourceUnits * (context.durationRatio ?? 1)))) * .8,
      // A displaced destination does not gain thematic identity by repeating
      // its landing. Residence and source-authored unisons remain legitimate.
      repetition: context.from === context.target ? 0 : Math.max(0, unisons - sourceUnisons) / Math.max(1, notes.length - 1)
        * (1.5 + context.familiarity * 3),
    };
    return { id: proposal.id, value: proposal.gesture, costs, tools: gestureTools(source, proposal.gesture) };
  });
  const selected = choosePlannedIdea(seed, address, candidates, context.plan, context.development * (1 - context.familiarity) * .025);
  return { id: selected.id, gesture: selected.value, costs: selected.costs, candidateCount: selected.candidates,
    tools: selected.tools, ...(selected.coverage ? { coverage: selected.coverage } : {}) };
}
