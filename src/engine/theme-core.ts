import type { HarmonyConfig } from '../harmonic-language';
import { TUNINGS, type TuningId } from '../pitch';
import type { LyricalNote, LyricalSentence } from './lyrical';
import { lyricalField } from './lyrical-support';
import { integer, random } from './random';
import type { Parameters } from '../types';
import { thematicCell, subdivideBetweenTargets, type IdeaCell } from './idea-kernel';
import { chooseIdea, IdeaGraph, type IdeaGraphDefinition } from './idea-graph';
import { chooseGesture, gestureTools, GESTURE_OPERATIONS, transformGesture, type Gesture, type GestureOperation } from './idea-tools';
import { choosePlannedIdea, type ToolCoverage } from './idea-selection';

/** Quotations, the primary line and its modal accompaniment share one identity. */
export function themeThird(seed: string, themeId: string): 3 | 4 {
  const minor = random(seed, 'motif-set', 'color') < .4;
  return themeId === 'theme-b' ? minor ? 4 : 3 : minor ? 3 : 4;
}
export interface ThemeDevelopmentPolicy {
  literal: boolean; amount: number; familiarity: number; selection: number;
}
export function themeDevelopment(seed: string, themeId: string, occurrence: number, heard: boolean,
  p: Pick<Parameters, 'melodicFamiliarity' | 'motifRecurrence' | 'motifTransformation'>): ThemeDevelopmentPolicy {
  // Full recall is deliberate. Ordinary recurrence remembers relationships
  // rather than selecting the entire same sentence on most returns.
  const recall = p.motifRecurrence === 1 ? 1 : p.motifRecurrence ** 3
    * (.25 + p.melodicFamiliarity * .75) * (1 - p.motifTransformation * .5);
  return { literal: !heard || occurrence === 0 || p.motifTransformation === 0
    || random(seed, 'thematic-return', themeId, occurrence) < recall,
    amount: p.motifTransformation, familiarity: p.melodicFamiliarity,
    selection: random(seed, 'thematic-development', themeId, occurrence) };
}
export type ThemeNoteRole = 'head' | 'continuation' | 'apex' | 'approach' | 'cadence';
export type ThemeGrammar = 'period' | 'sentence' | 'arch-reprise' | 'generated';
export type ThemeContour = 'ascending' | 'descending' | 'terraced' | 'orbiting' | 'pendulum' | 'level';
export interface ThemeCoreNote {
  id: string; degree: number; rhythmUnits: number; role: ThemeNoteRole; purpose: string;
}
export interface ThemeCoreClause {
  id: string; sourceId: string; label: string; role: 'question' | 'answer';
  spanUnits: number; notes: readonly ThemeCoreNote[];
  parentId?: string; goalDegree?: number; relationship?: string;
  operations?: readonly GestureOperation[];
}
export interface ThemeFingerprint { sourceId: string; intervals: number[]; rhythmUnits: number[] }
export interface ThemeCore {
  id: string; name: string; headId: string; grammar: ThemeGrammar; third: 3 | 4;
  clauses: readonly ThemeCoreClause[]; contour?: ThemeContour; goals?: readonly number[];
  fingerprint?: ThemeFingerprint; cell?: IdeaCell; generationSeed?: string;
  /** Reusable source membership; occurrences may inherit or isolate sets. */
  ideaGraph?: IdeaGraphDefinition<string>; ideaScope?: string;
}
export interface ThemeCoreSnapshot {
  id: string; name: string; headId: string; grammar: ThemeGrammar;
  treatment: HarmonyConfig['treatment']; occurrence: number; transpositionDegrees: number;
  notes: Array<{ id: string; sourceId: string; degree: number; role: ThemeNoteRole; purpose: string;
    startTick: number; endTick: number; absolutePitchCents: number }>;
  realization?: ThemeArgumentRealization;
}
export interface ThemeArgumentPolicy {
  seed: string; ideaDensity: number; activity: number; register: number;
  intervalComplexity?: number; familiarity?: number;
  contour?: ThemeContour; endingDegree?: number; syncopation?: number;
  rhythm?: { sourceId: string; cycleTicks: number; cell: readonly { offsetTicks: number; strength: number; role: string }[] };
}
export interface ThemeArgumentRealization {
  kind: 'spacious' | 'singing' | 'motivic' | 'virtuosic';
  density: number; headDiminution: number; registerSpanCents: number; rhythmSourceId?: string;
  contour?: ThemeContour; endingDegree?: number; fingerprint?: ThemeFingerprint;
  sourceCoverage?: ToolCoverage;
  clauses?: Array<{ operation: string; startTick: number; endTick: number; goalDegree: number; rhythmFamily: string }>;
  motifs?: Array<{ id: string; sourceId: string; parentId: string; startTick: number; endTick: number;
    goalDegree: number; relationship: string; attackCount: number }>;
  phrases?: Array<{ id: string; sourceId: string; motifId: string; startTick: number; endTick: number;
    transpositionDegrees: number; intervalScale: number; coreNotes: number;
    operations?: readonly GestureOperation[]; costs?: Record<string, number>; candidatesEvaluated?: number;
    tools?: readonly string[]; coverage?: ToolCoverage;
    anchors?: Array<{ tick: number; degree: number; units: number; strength: number }>;
    refinement?: 'directed-metric' }>;
}
export interface ThemeOccurrenceInput {
  startTick: number; endTick: number; tuning: TuningId; occurrence: number; cadence: 'open' | 'closed';
  treatment: HarmonyConfig['treatment']; development?: ThemeDevelopmentPolicy; argument?: ThemeArgumentPolicy;
  beatTicks?: number;
  ideaScope?: string;
}
const bound = (n: number, low: number, high: number) => Math.max(low, Math.min(high, n));
const stable = (degree: number) => [0, 2, 4].includes(((degree % 7) + 7) % 7);
function comparePath(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] - b[i];
  return a.length - b.length;
}
interface Path { degrees: number[]; cost: number }

/** Compose the complete identifying gesture around one chosen interval and
 * held field landing. This is a bounded pitch search, not a tune catalogue. */
function generateHead(seed: string, id: string, cell: IdeaCell): number[] {
  const count = cell.attacks.length;
  const signatureAt = cell.attacks.slice(1, -1).reduce((best, attack, i, attacks) =>
    attack.strength > attacks[best - 1].strength ? i + 1 : best, 1);
  const width = 1 + Math.floor(random(seed, 'subject-design', id, 'width') ** 1.35 * 7);
  const direction = random(seed, 'subject-design', id, 'direction') < .5 ? -1 : 1;
  const entrance = integer(seed, 'subject-design', -1, 4, id, 'entrance');
  let beam: Path[] = [{ degrees: [], cost: 0 }];
  for (let index = 0; index < count; index++) {
    const candidates: Path[] = [];
    for (const parent of beam) for (let degree = -5; degree <= 9; degree++) {
      const previous = parent.degrees.at(-1), step = previous === undefined ? 0 : degree - previous;
      if (index === signatureAt && (step !== direction * width || !stable(degree))) continue;
      if (index > 0 && index !== signatureAt && Math.abs(step) > 2) continue;
      const directions = parent.degrees.slice(1).map((value, n) => Math.sign(value - parent.degrees[n])).filter(Boolean);
      if (step) directions.push(Math.sign(step));
      if (directions.slice(1).filter((value, n) => value !== directions[n]).length > 1) continue;
      // Retain feasible prefixes before the intended signature.
      if (index === signatureAt - 1 && (degree + direction * width < -5
        || degree + direction * width > 9 || !stable(degree + direction * width))) continue;
      const after = index > signatureAt;
      const cost = parent.cost + (index ? Math.abs(step) * .035 + (step === 0 ? .16 : 0) : Math.abs(degree - entrance) * .5)
        + (after ? Math.abs(step + direction) * .09 : 0)
        + (stable(degree) ? 0 : cell.attacks[index].strength * .1)
        + random(seed, 'subject-path', id, index, degree, previous ?? 0) * .28;
      candidates.push({ degrees: [...parent.degrees, degree], cost });
    }
    beam = candidates.sort((a, b) => a.cost - b.cost || comparePath(a.degrees, b.degrees)).slice(0, 32);
    if (!beam.length) throw new Error('Thematic head has no feasible interval path.');
  }
  return beam[0].degrees;
}

/** Establish, depart, optionally redirect. These are destinations of the same
 * idea, not independent walks. A deliberate change of direction must buy a
 * return toward the established register; subdivisions cannot add new turns. */
function generateGoals(seed: string, id: string, from: number, count: number): number[] {
  const reach = 3 + random(seed, 'goal-design', id, 'reach') * 8;
  const direction = random(seed, 'goal-design', id, 'direction') < .5 ? -1 : 1;
  const returning = count > 2 && random(seed, 'goal-design', id, 'return') < .3;
  const candidates = Array.from({ length: 18 }, (_, n) => {
    const peak = n - 6;
    const values = count === 2 ? [from, peak] : returning
      ? [from, peak, Math.round((peak + from) / 2)] : [from, Math.round((peak + from) / 2), peak];
    return { id: `destination-${peak}`, value: values, costs: {
      reach: Math.abs(Math.abs(peak - from) - reach),
      direction: Math.sign(peak - from) === direction ? 0 : 2,
      arrival: stable(peak) ? 0 : .4,
    } };
  });
  return chooseIdea(seed, `${id}:destinations`, candidates, .15).value;
}
function describeContour(values: readonly number[]): ThemeContour {
  if (Math.max(...values) - Math.min(...values) <= 2) return 'level';
  const deltas = values.slice(1).map((value, i) => Math.sign(value - values[i])).filter(Boolean);
  if (deltas.every(v => v >= 0)) return 'ascending';
  if (deltas.every(v => v <= 0)) return 'descending';
  const turns = deltas.slice(1).filter((v, i) => v !== deltas[i]).length;
  return turns > 1 ? 'pendulum' : Math.abs(values.at(-1)! - values[0]) <= 2 ? 'orbiting' : 'terraced';
}
const sources = new Map<string, ThemeCore>();
export function composeThemeCore(seed: string, themeId: string, third: 3 | 4): ThemeCore {
  const key = JSON.stringify([seed, themeId, third]), cached = sources.get(key);
  if (cached) return structuredClone(cached);
  const id = 'core:' + themeId, headId = id + ':head', cell = thematicCell(seed, themeId);
  const degrees = generateHead(seed, headId, cell);
  const head: ThemeCoreNote[] = degrees.map((degree, i) => ({ id: headId + ':' + i, degree,
    rhythmUnits: cell.attacks[i].holdUnits, role: 'head', purpose: i === 0 ? 'Establish the identifying rhythm and register.'
      : Math.abs(degree - degrees[i - 1]) > 2 ? 'Give the signature interval a stable field landing.'
        : 'Continue the identifying gesture with controlled recovery.' }));
  const fingerprint = { sourceId: headId, intervals: degrees.slice(1).map((d, i) => d - degrees[i]),
    rhythmUnits: head.map(n => n.rhythmUnits) };
  const goals = generateGoals(seed, id, degrees.at(-1)!, integer(seed, 'goal-design', 2, 3, id, 'count'));
  const subject: Gesture = { sourceId: headId, operations: [], notes: head.map((note, n) => ({
    degree: note.degree, units: note.rhythmUnits, strength: cell.attacks[n].strength })) };
  const clauses: ThemeCoreClause[] = [{ id: id + ':motif-0', sourceId: headId, parentId: id,
    label: 'Question · establish the identifying gesture', role: 'question', spanUnits: 4, notes: head,
    goalDegree: degrees.at(-1)!, relationship: 'Original interval and accent fingerprint' }];
  let previous = degrees.at(-1)!;
  for (let i = 0; i <= goals.length; i++) {
    const closing = i === goals.length, target = closing ? 0 : goals[i], sourceId = id + ':motif-' + (i + 1);
    const count = i === 0 ? head.length : Math.max(3, Math.ceil(Math.abs(target - previous) / 7) + 1,
      integer(seed, 'source-motif', 3, 5, sourceId, 'count'));
    const gesture = i === 0 ? transformGesture(subject, [{ kind: 'transpose', degrees: target - degrees.at(-1)! }])
      : chooseGesture(seed, sourceId, subject, { from: previous, target, count, development: .6,
        familiarity: .75, closing, maximumLeap: 7, pitchClasses: [0, 2, 4],
        durationRatio: closing ? 2 : Math.abs(target - previous) > 4 ? 1 : .5 }).gesture;
    const role = i < Math.ceil(goals.length / 2) ? 'question' : 'answer';
    const relationship = i === 0 ? 'Restate the identifying interval and rhythm fingerprint'
      : gesture.operations.map(operation => operation.kind).join(' → ') + ' toward degree ' + target;
    clauses.push({ id: sourceId, sourceId, parentId: headId, role,
      label: (role === 'question' ? 'Question' : 'Answer') + ' · ' + (closing ? 'prepare the destination' : 'continue toward degree ' + target),
      spanUnits: gesture.notes.reduce((sum, note) => sum + note.units, 0) / cell.pulseUnits,
      goalDegree: target, relationship, operations: gesture.operations,
      notes: gesture.notes.map((note, n) => ({ id: sourceId + ':' + n, degree: note.degree, rhythmUnits: note.units,
        role: closing && n === count - 1 ? 'cadence' : closing && n === count - 2 ? 'approach' : 'continuation',
        purpose: n === count - 1 ? 'Hold the destination of this related motif.' : 'Connect a source interval relationship to its planned goal.' })) });
    previous = target;
  }
  const contour = describeContour([degrees.at(-1)!, ...goals]);
  const split = Math.ceil(clauses.length / 2);
  const ideaGraph: IdeaGraphDefinition<string> = {
    sets: clauses.map(clause => ({ id: `${clause.sourceId}:set`, ideas: [{ id: clause.sourceId, value: clause.sourceId }] })),
    scopes: [
      { id, sets: [`${headId}:set`] },
      { id: `${id}:question`, parents: [id], sets: clauses.slice(1, split).map(clause => `${clause.sourceId}:set`) },
      { id: `${id}:answer`, parents: [id], sets: clauses.slice(split).map(clause => `${clause.sourceId}:set`) },
      { id: `${id}:argument`, parents: [`${id}:question`, `${id}:answer`] },
      ...clauses.map(clause => ({ id: `${clause.sourceId}:local`, parents: [id], sets: [`${clause.sourceId}:set`] })),
    ],
  };
  const source: ThemeCore = { id, name: clauses.length + '-motif ' + contour + ' argument', headId, grammar: 'generated',
    third, clauses, contour, goals, fingerprint, cell, generationSeed: seed, ideaGraph, ideaScope: `${id}:argument` };
  if (sources.size >= 128) sources.delete(sources.keys().next().value!);
  sources.set(key, source); return structuredClone(source);
}

function openDestination(from: number): number {
  return Array.from({ length: 20 }, (_, i) => i - 7).filter(d => [2, 4].includes(((d % 7) + 7) % 7))
    .sort((a, b) => Math.abs(a - from) - Math.abs(b - from) || a - b)[0];
}
/** One source graph, one occurrence compiler. Density spends a subdivision
 * budget between held goals; it never swaps in an unrelated slow/fast tune.
 * The complete opening fingerprint is retained once. Developed continuations
 * can change goal, interval scale, ordering and temporal emphasis together. */
export function realizeThemeCore(core: ThemeCore, input: ThemeOccurrenceInput): LyricalSentence {
  const span = input.endTick - input.startTick;
  if (!Number.isSafeInteger(span) || span < 3840 || input.startTick < 0 || !Number.isSafeInteger(input.startTick) || !Number.isSafeInteger(input.endTick))
    throw new RangeError('A thematic occurrence needs an integer span of at least eight quarter notes.');
  const policy = input.argument, seed = policy?.seed ?? core.generationSeed ?? core.id;
  const density = bound(policy?.ideaDensity ?? .46, 0, 1), pulse = input.beatTicks ?? 480;
  if (!Number.isSafeInteger(pulse) || pulse <= 0) throw new RangeError('A thematic occurrence needs a positive integer pulse.');
  const development = input.treatment === 'develop' ? input.development ?? {
    literal: input.occurrence === 0, amount: .65, familiarity: .6,
    selection: random(seed, 'thematic-development', core.id, input.occurrence) } : undefined;
  const amount = development && !development.literal ? development.amount : 0;
  const variant = amount ? Math.floor(development!.selection * 1000000) + input.occurrence : 0;
  const familiarity = bound(amount ? development!.familiarity : .65, 0, 1);
  const departure = amount * (1 - familiarity * .7);
  const complexity = bound(policy?.intervalComplexity ?? .75, 0, 1);
  const maximumLeap = Math.max(2, Math.min(7, 2 + Math.round(complexity * (1 - familiarity * .25) * 5)));
  const scope = input.ideaScope ?? core.ideaScope;
  if (scope && !core.ideaGraph) throw new RangeError('A named argument scope requires an idea graph.');
  const inherited = core.ideaGraph && scope ? new Set(new IdeaGraph(core.ideaGraph).resolve(scope).map(idea => idea.value)) : undefined;
  if (inherited && [...inherited].some(id => !core.clauses.some(clause => clause.sourceId === id)))
    throw new RangeError('An argument scope references unknown source material.');
  const material = core.clauses.filter(clause => !inherited || inherited.has(clause.sourceId));
  const head = material.find(clause => clause.sourceId === core.headId);
  if (!head || material.length < 2) throw new RangeError('An argument scope needs its identifying head and a destination.');
  const body = material.filter(clause => clause !== head);
  if (material.some(clause => !clause.notes.length || !Number.isFinite(clause.spanUnits) || clause.spanUnits <= 0
    || clause.notes.some(note => !Number.isFinite(note.degree) || !Number.isFinite(note.rhythmUnits) || note.rhythmUnits <= 0)))
    throw new RangeError('An argument needs valid source gestures.');
  // A scope is an available vocabulary, not an obligation to recite every
  // member. Spacious thoughts state and answer; ordinary singing can recall
  // the subject; active development has room for the intermediate departures.
  const activeBodies = density < .28 ? 1 : density < .6 ? 2 : body.length;
  let sourceCoverage: ToolCoverage | undefined;
  if (body.length > activeBodies) {
    const destination = body.at(-1)!;
    const replies = body.slice(0, -1);
    const selected = amount && activeBodies === 2 ? choosePlannedIdea(seed, `${core.id}:reply:${variant}`,
      replies.map((clause, index) => ({ id: clause.sourceId, value: clause, tools: [clause.sourceId], costs: {
        // The occurrence compiler can transpose/invert the entry. Evaluate the
        // distance to the whole gesture's goal, not its untransformed first note.
        continuity: Math.abs((clause.goalDegree ?? clause.notes.at(-1)!.degree) - head.notes.at(-1)!.degree)
          / (maximumLeap * clause.notes.length) * .3,
        identity: index === 0 ? 0 : familiarity * .4,
      } })), { scope: `${core.id}:replies`, ordinal: input.occurrence,
        vocabulary: replies.map(clause => clause.sourceId), maxRegret: departure * .6 }) : undefined;
    sourceCoverage = selected?.coverage;
    body.splice(0, body.length, ...(selected ? [selected.value] : body.slice(0, activeBodies - 1)), destination);
  }
  if (span < body.length * 360 + head.notes.length * 40)
    throw new RangeError('An argument needs enough time for its active head and destinations.');
  if (departure > .45 && body.length > 2) {
    const closing = body.pop()!;
    const decision = chooseIdea(seed, `${core.id}:development-${variant}`, body.map((_, rotation) => {
      const value = [...body.slice(rotation), ...body.slice(0, rotation)];
      const endpoints = [head.notes.at(-1)!.degree, ...value.map(clause => clause.goalDegree ?? clause.notes.at(-1)!.degree), closing.goalDegree ?? 0];
      return { id: `route-${rotation}`, value, costs: {
        continuity: endpoints.slice(1).reduce((sum, goal, i) => sum + Math.max(0, Math.abs(goal - endpoints[i]) - maximumLeap) / 7, 0),
        renewal: rotation === 0 ? departure : 0,
      } };
    }), departure * .4);
    body.splice(0, body.length, ...decision.value, closing);
  }
  const source = [head, ...body];
  const sharedRhythm = policy?.rhythm?.cell.length === head.notes.length ? policy.rhythm : undefined;
  if (sharedRhythm && (!Number.isSafeInteger(sharedRhythm.cycleTicks) || sharedRhythm.cycleTicks <= 0
    || sharedRhythm.cell.some((attack, index) => !Number.isSafeInteger(attack.offsetTicks)
      || attack.offsetTicks < 0 || attack.offsetTicks >= sharedRhythm.cycleTicks
      || (index === 0 ? attack.offsetTicks !== 0 : attack.offsetTicks <= sharedRhythm.cell[index - 1].offsetTicks)
      || !Number.isFinite(attack.strength) || attack.strength < 0 || attack.strength > 1)))
    throw new RangeError('A shared subject rhythm needs an integer cycle, ordered onsets and bounded strengths.');
  const recallsHead = source.map((clause, index) => index > 0 && index < source.length - 1
    && clause.notes.length === head.notes.length && clause.notes.every((note, n) =>
      note.degree - clause.notes[0].degree === head.notes[n].degree - head.notes[0].degree
      && note.rhythmUnits / clause.notes[0].rhythmUnits === head.notes[n].rhythmUnits / head.notes[0].rhythmUnits));
  const goals = source.map((clause, i) => i === 0 ? clause.notes.at(-1)!.degree
    : bound((clause.goalDegree ?? clause.notes.at(-1)!.degree)
      + (amount ? integer(seed, 'occurrence-goal', -Math.ceil(departure * 3), Math.ceil(departure * 3), core.id, variant, i) : 0), -6, 11));
  const ending = input.cadence === 'closed' ? 0 : policy?.endingDegree ?? openDestination(goals.at(-2)!);
  goals[goals.length - 1] = bound(ending, -7, 12);
  const weights = source.map((clause, i) => clause.spanUnits * (i === 0 ? .45 + (1 - density) * .75
    : 1 + departure * (random(seed, 'occurrence-span', core.id, variant, i) - .5) * .5));
  const minimumSpan = 360, headUnits = core.cell?.units ?? head.notes.reduce((sum, n) => sum + n.rhythmUnits, 0);
  const minimumHeadSpan = head.notes.length * 40 + (source.length === 2 ? 120 : 0);
  if (span < minimumSpan * body.length + minimumHeadSpan)
    throw new RangeError('An argument needs room for every identifying note and its breath.');
  const roomForHead = Math.min(span - minimumSpan * body.length,
    Math.max(minimumHeadSpan, Math.min(1920, Math.floor(span * (.5 - density * .25) / 120) * 120)));
  // The fingerprint uses ordinary integral augmentation, not arbitrary
  // time stretching. Only a genuinely short handoff permits a finer grid.
  const wantedHeadUnit = density > .6 ? 120 : density > .28 ? 240 : 480;
  const headUnit = Math.max(40, Math.min(wantedHeadUnit, Math.floor(roomForHead / headUnits / 120) * 120 || 60));
  const headSpan = Math.min(roomForHead, Math.max(minimumHeadSpan, headUnits * headUnit));
  const remainingSpan = span - headSpan - minimumSpan * body.length;
  let consumed = 0;
  const bodyWeight = weights.slice(1).reduce((a, b) => a + b, 0);
  const boundaries = [input.startTick, input.startTick + headSpan];
  for (let i = 1; i < source.length - 1; i++) {
    consumed += weights[i];
    boundaries.push(input.startTick + headSpan + minimumSpan * i + Math.round(remainingSpan * consumed / bodyWeight / 120) * 120);
  }
  boundaries.push(input.endTick);
  const rate = .16 + density ** 3 * 3.8;
  const budget = Math.max(head.notes.length + body.length * 2, Math.min(256, Math.round(span / 480 * rate)));
  const bodyBudget = budget - head.notes.length;
  const recallBudget = recallsHead.reduce((sum, recall, i) => sum + (recall ? source[i].notes.length : 0), 0);
  const movingWeight = weights.slice(1).reduce((sum, weight, i) => sum + (recallsHead[i + 1] ? 0 : weight), 0);
  const field = lyricalField(input.tuning, core.third), divisions = TUNINGS[input.tuning].divisions;
  const nativeCents = (degree: number) => Math.round((field[((degree % 7) + 7) % 7]
    + Math.floor(degree / 7) * divisions) * 1200000 / divisions) / 1000;
  const segments: LyricalSentence['segments'] = [], rests: LyricalSentence['rests'] = [];
  const motifs: NonNullable<ThemeArgumentRealization['motifs']> = [];
  const phrases: NonNullable<ThemeArgumentRealization['phrases']> = [];
  let previous = head.notes[0].degree;
  for (let i = 0; i < source.length; i++) {
    const clause = source[i], from = boundaries[i], to = boundaries[i + 1], last = i === source.length - 1;
    const role = i < Math.ceil(source.length / 2) ? 'question' : 'answer';
    const questionEnd = i === Math.ceil(source.length / 2) - 1;
    const breath = (last && input.cadence === 'closed' || questionEnd) && to - from >= 480 ? 120 : 0;
    const soundingEnd = to - breath, available = soundingEnd - from;
    if (breath) rests.push({ startTick: soundingEnd, endTick: to,
      reason: last ? 'The complete argument releases after its destination.' : 'A breath separates the question from its answer.' });
    let points: Array<{ tick: number; durationTicks: number; strength: number }>, path: number[];
    let application: { gesture: Gesture; costs: Record<string, number>; candidateCount: number;
      tools?: readonly string[]; coverage?: ToolCoverage;
      anchors?: Array<{ tick: number; degree: number; units: number; strength: number }> };
    if (i === 0) {
      const shared = sharedRhythm;
      const units = shared ? shared.cycleTicks : head.notes.reduce((sum, note) => sum + note.rhythmUnits, 0);
      const grid = headUnit >= 120 && available >= head.notes.length * 120 ? 120 : 40;
      let elapsed = 0, priorTick = from - grid;
      const ticks = head.notes.map((note, n) => {
        const fraction = shared ? shared.cell[n].offsetTicks / units : elapsed / units;
        elapsed += note.rhythmUnits;
        const tick = n === 0 ? from : Math.max(priorTick + grid,
          Math.min(soundingEnd - (head.notes.length - n) * grid, from + Math.round(available * fraction / grid) * grid));
        priorTick = tick;
        return tick;
      });
      points = ticks.map((tick, n) => ({ tick, durationTicks: (ticks[n + 1] ?? soundingEnd) - tick,
        strength: shared?.cell[n].strength ?? core.cell?.attacks[n]?.strength ?? (n === 0 ? 1 : .7) }));
      path = head.notes.map(note => note.degree);
      application = { costs: {}, candidateCount: 1,
        gesture: { sourceId: core.headId, operations: [], notes: head.notes.map((note, n) => ({
          degree: note.degree, units: note.rhythmUnits, strength: points[n].strength })) } };
    } else {
      const target = goals[i], required = Math.max(recallsHead[i] ? head.notes.length : 2,
        Math.ceil(Math.abs(target - previous) / maximumLeap) + (last ? 1 : 0));
      // The first reply is a complete recall, not a loop to fill the density
      // budget. Activity is spent elaborating the remaining destinations.
      const desired = recallsHead[i] ? required : Math.max(required,
        Math.round((bodyBudget - recallBudget) * weights[i] / movingWeight));
      const count = Math.max(required, Math.min(desired, clause.notes.length));
      const recall = recallsHead[i] && (!amount || familiarity >= .5);
      const subject: Gesture = { sourceId: recall ? core.headId : clause.sourceId, operations: [],
        notes: (recall ? head : clause).notes.map((note, n) => ({ degree: note.degree, units: note.rhythmUnits,
          strength: recall ? core.cell?.attacks[n]?.strength ?? .8 : .8 })) };
      const quoted = recall && count === head.notes.length
        ? transformGesture(subject, [{ kind: 'transpose', degrees: target - head.notes.at(-1)!.degree }]) : undefined;
      const feasibleQuote = quoted && Math.abs(quoted.notes[0].degree - previous) <= 7
        && quoted.notes.every(note => note.degree >= -7 && note.degree <= 12);
      const decision = feasibleQuote ? { gesture: quoted, costs: { identity: 0 }, candidateCount: 1, tools: gestureTools(subject, quoted) }
        : chooseGesture(seed, `${core.id}:${variant}:${i}:skeleton`, subject, {
          from: previous, target, count, closing: last, maximumLeap, development: departure, familiarity,
          pitchClasses: [0, 2, 4], durationMode: 'relative',
          ...(amount ? { plan: { scope: `${core.id}:${clause.sourceId}:gestures`, ordinal: input.occurrence,
            vocabulary: Object.keys(GESTURE_OPERATIONS).filter(tool => tool !== 'time-scale'), maxRegret: departure * .6 } } : {}),
        });
      const skeleton = decision.gesture.notes;
      const holdWanted = last ? Math.min(density < .6 ? 1920 : 960, Math.max(density < .6 ? 480 : 720, Math.round(available * .3 / 120) * 120))
        : Math.min(960, Math.max(120, Math.round(available * (.22 - density * .1) / 120) * 120));
      const hold = Math.max(40, Math.min(holdWanted, available - (count - 1) * 40));
      const goalTick = Math.max(from + 40 * (count - 1),
        input.startTick + Math.floor((soundingEnd - hold - input.startTick) / 120) * 120);
      const coarse = density > .85 ? 80 : density > .6 ? 120 : density > .3 ? 240 : 480;
      const grid = Math.max(40, Math.min(coarse, Math.floor((goalTick - from) / Math.max(1, required - 1) / 40) * 40));
      const connectorGrid = (goalTick - from) / (count - 1) >= 120 ? 120 : 40;
      const movingUnits = skeleton.slice(0, -1).reduce((sum, note) => sum + note.units, 0);
      let unitPosition = 0, lastTick = from - connectorGrid;
      const anchors = skeleton.map((note, n) => {
        const tick = n === count - 1 ? goalTick : Math.max(lastTick + connectorGrid,
          Math.min(goalTick - (count - 1 - n) * connectorGrid,
            from + Math.round((goalTick - from) * unitPosition / movingUnits / connectorGrid) * connectorGrid));
        unitPosition += note.units; lastTick = tick;
        return { tick, strength: note.strength };
      });
      const subdivisions = subdivideBetweenTargets(seed, core.id + ':' + clause.sourceId + ':' + variant, {
        startTick: from - input.startTick, endTick: goalTick - input.startTick, gridTicks: grid, attackBudget: Math.max(required - 1, desired - 1),
        anchors: anchors.slice(0, -1).map(anchor => ({ ...anchor, tick: anchor.tick - input.startTick })),
        syncopation: bound(policy?.syncopation ?? .2, 0, 1) * (.25 + density * .75),
        pulseTicks: pulse, originTick: 0, direction: Math.sign(target - previous) });
      points = [...subdivisions.map(p => ({ ...p, tick: p.tick + input.startTick })),
        { tick: goalTick, durationTicks: soundingEnd - goalTick, strength: 1 }];
      // Refine the written skeleton in one direction between each pair of
      // anchors. More attacks never add contour cycles or new destinations.
      // The chosen source rhythm owns anchor timing; the metric hierarchy
      // owns the extra attacks between them.
      path = points.map(point => {
        const next = anchors.findIndex(anchor => anchor.tick > point.tick);
        if (next < 0) return skeleton.at(-1)!.degree;
        const left = next - 1, phase = (point.tick - anchors[left].tick) / (anchors[next].tick - anchors[left].tick);
        return skeleton[left].degree + Math.round((skeleton[next].degree - skeleton[left].degree) * phase);
      });
      const repeatedIntent = decision.gesture.operations.some(operation => operation.kind === 'pedal')
        || clause.operations?.some(operation => operation.kind === 'pedal') && skeleton.every(note => note.degree === skeleton[0].degree);
      if (!repeatedIntent) {
        const structural = new Set(anchors.map(anchor => anchor.tick));
        const retained = points.map((_, n) => n).filter(n => n === 0 || structural.has(points[n].tick) || path[n] !== path[n - 1]);
        points = retained.map(n => points[n]); path = retained.map(n => path[n]);
        points.forEach((point, n) => { point.durationTicks = (points[n + 1]?.tick ?? soundingEnd) - point.tick; });
      }
      application = { ...decision, anchors: skeleton.map((note, n) => ({ ...note, tick: anchors[n].tick })) };
    }
    const sourceId = i === 0 ? core.headId : clause.sourceId + (amount ? ':development-' + variant : '');
    const relationship = i === 0 ? 'Original interval and accent fingerprint' : amount
      ? 'Develop inherited intervals toward degree ' + goals[i] : clause.relationship ?? 'Continue the source relationship';
    const notes: LyricalNote[] = points.map((point, n) => {
      const degree = path[n], final = n === points.length - 1;
      const coreRole: ThemeNoteRole = i === 0 ? 'head' : last && final ? 'cadence'
        : last && n === points.length - 2 ? 'approach' : 'continuation';
      return { tick: point.tick, duration: Math.min(input.endTick - point.tick, point.durationTicks
        + (!final || !breath && !last ? 18 : 0)), degree, cents: nativeCents(degree),
        accent: bound(.57 + point.strength * .37 + (final ? .02 : 0), .5, .97),
        landing: last && final && input.cadence === 'closed', protectedTheme: true,
        function: i === 0 ? 'quote' : last && final ? 'arrival' : 'development',
        sourceId: i === 0 ? head.notes[n].id : sourceId + ':note-' + n,
        coreRole, corePurpose: final ? 'Hold the planned destination of this source-related motif.'
          : i === 0 ? head.notes[n].purpose : 'Carry the source interval relationship toward the held goal at degree ' + goals[i] + '.' };
    });
    previous = path.at(-1)!;
    const label = (role === 'question' ? 'Question' : 'Answer') + ' · ' + (i === 0 ? 'state the fingerprint'
      : last ? input.cadence === 'closed' ? 'settle the destination' : 'handoff toward degree ' + goals[i]
        : 'develop toward degree ' + goals[i]);
    segments.push({ startTick: from, endTick: to, label, role, sourceId, notes });
    motifs.push({ id: core.id + ':occurrence-' + variant + ':motif-' + i, sourceId,
      parentId: i === 0 ? core.id : clause.sourceId, startTick: from, endTick: to,
      goalDegree: previous, relationship, attackCount: notes.length });
    const { gesture, costs, candidateCount } = application;
    phrases.push({ id: motifs.at(-1)!.id + ':phrase-0',
        sourceId: gesture.sourceId, motifId: motifs.at(-1)!.id, startTick: notes[0].tick, endTick: to,
        transpositionDegrees: notes[0].degree - core.clauses.find(source => source.sourceId === gesture.sourceId)!.notes[0].degree,
        intervalScale: gesture.operations.reduce((scale, operation) => operation.kind === 'interval-scale'
          ? scale * operation.factor : operation.kind === 'invert' ? -scale : scale, 1), coreNotes: notes.length,
        operations: gesture.operations, costs, candidatesEvaluated: candidateCount,
        ...(application.tools ? { tools: application.tools } : {}),
        ...(application.coverage ? { coverage: application.coverage } : {}),
        ...(application.anchors ? { anchors: application.anchors, refinement: 'directed-metric' as const } : {}) });
  }
  const notes = segments.flatMap(segment => segment.notes);
  const highPointTick = notes.find(note => note.degree === Math.max(...notes.map(n => n.degree)))!.tick;
  const contour = describeContour([head.notes.at(-1)!.degree, ...goals.slice(1, -1)]);
  return { notes, segments, rests, headId: core.headId, highPointTick,
    realization: { kind: density < .28 ? 'spacious' : density < .6 ? 'singing' : density < .84 ? 'motivic' : 'virtuosic',
      density, headDiminution: Math.round(span / 4 / (boundaries[1] - boundaries[0]) * 1000) / 1000,
      registerSpanCents: Math.max(...notes.map(n => n.cents)) - Math.min(...notes.map(n => n.cents)),
      rhythmSourceId: sharedRhythm?.sourceId ?? core.cell?.id ?? core.headId, contour, endingDegree: notes.at(-1)!.degree,
      fingerprint: structuredClone(core.fingerprint), motifs, phrases, ...(sourceCoverage ? { sourceCoverage } : {}),
      clauses: motifs.map(motif => ({ operation: motif.relationship, startTick: motif.startTick, endTick: motif.endTick,
        goalDegree: motif.goalDegree, rhythmFamily: 'generated metric subdivision' })) } };
}
