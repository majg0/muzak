import { random } from './random';

/** Sources belong to reusable sets. Scopes describe ownership/inheritance, not
 * copies of notes: two phrases can share a set without sharing an occurrence. */
export interface Idea<T> { id: string; value: T; }
export interface IdeaSet<T> { id: string; ideas: readonly Idea<T>[]; }
export interface IdeaScope {
  id: string;
  parents?: readonly string[];
  sets?: readonly string[];
  /** An isolated scope retains its structural parents but imports no ideas. */
  inherit?: boolean;
}
export interface IdeaGraphDefinition<T> { sets: readonly IdeaSet<T>[]; scopes: readonly IdeaScope[]; }
export interface ScopedIdea<T> extends Idea<T> { setId: string; owners: string[]; }

/** Immutable, validated DAG. Resolve is a union, never a traversal-dependent
 * override or a sum: a shared ancestor in a diamond is counted exactly once.
 * Local variation gets its own source identity, so provenance is unambiguous. */
export class IdeaGraph<T> {
  private readonly sets: Map<string, IdeaSet<T>>;
  private readonly scopes: Map<string, IdeaScope>;
  private readonly cache = new Map<string, ScopedIdea<T>[]>();
  constructor(definition: IdeaGraphDefinition<T>) {
    const copy = structuredClone(definition);
    const index = <V extends { id: string }>(items: readonly V[], kind: string) => {
      const values = new Map<string, V>();
      for (const item of items) {
        if (!item.id || values.has(item.id)) throw new RangeError(`Duplicate or empty ${kind}: ${item.id}`);
        values.set(item.id, item);
      }
      return values;
    };
    this.sets = index(copy.sets, 'idea set');
    this.scopes = index(copy.scopes, 'idea scope');
    index(copy.sets.flatMap(set => [...set.ideas]), 'idea');
    const visited = new Set<string>(), visiting = new Set<string>();
    for (const root of this.scopes.keys()) {
      const stack = [{ id: root, exit: false }];
      while (stack.length) {
        const { id, exit } = stack.pop()!;
        if (exit) { visiting.delete(id); visited.add(id); continue; }
        if (visited.has(id)) continue;
        if (visiting.has(id)) throw new RangeError(`Cyclic idea inheritance at ${id}`);
        const scope = this.scopes.get(id);
        if (!scope) throw new RangeError(`Unknown idea scope: ${id}`);
        visiting.add(id);
        for (const set of scope.sets ?? []) if (!this.sets.has(set)) throw new RangeError(`Unknown idea set: ${set}`);
        stack.push({ id, exit: true });
        for (const parent of scope.parents ?? []) stack.push({ id: parent, exit: false });
      }
    }
  }
  resolve(id: string): ScopedIdea<T>[] {
    if (!this.scopes.has(id)) throw new RangeError(`Unknown idea scope: ${id}`);
    const cached = this.cache.get(id);
    if (cached) return structuredClone(cached);
    const sources = new Map<string, ScopedIdea<T>>(), visited = new Set<string>();
    const pending = [id];
    while (pending.length) {
      const at = pending.pop()!;
      if (visited.has(at)) continue;
      visited.add(at);
      const scope = this.scopes.get(at)!;
      if (scope.inherit !== false) pending.push(...scope.parents ?? []);
      for (const setId of scope.sets ?? []) for (const idea of this.sets.get(setId)!.ideas) {
        const prior = sources.get(idea.id);
        if (prior) { if (!prior.owners.includes(at)) prior.owners.push(at); }
        else sources.set(idea.id, { ...idea, setId, owners: [at] });
      }
    }
    const result = [...sources.values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    for (const idea of result) idea.owners.sort();
    this.cache.set(id, result);
    return structuredClone(result);
  }
}

export interface EvaluatedIdea<T> extends Idea<T> {
  /** Named, nonnegative costs make a choice inspectable. Infinity rejects it. */
  costs: Readonly<Record<string, number>>;
}
export interface IdeaDecision<T> extends EvaluatedIdea<T> { cost: number; candidates: number; }

/** All candidates must first be musically evaluated. An addressed exponential
 * race samples exp(-cost / temperature); zero temperature gives the optimum.
 * Order, unrelated random calls and underflow cannot alter the decision. */
export function chooseIdea<T>(seed: string, address: string, candidates: readonly EvaluatedIdea<T>[], temperature = 0): IdeaDecision<T> {
  if (!Number.isFinite(temperature) || temperature < 0) throw new RangeError('Idea temperature must be finite and nonnegative.');
  const ids = new Set<string>();
  const evaluated = candidates.map(candidate => {
    if (!candidate.id || ids.has(candidate.id)) throw new RangeError('Evaluated ideas need unique identities.');
    ids.add(candidate.id);
    const costs = Object.values(candidate.costs);
    if (costs.some(cost => Number.isNaN(cost) || cost < 0)) throw new RangeError('Idea costs must be nonnegative.');
    return { ...candidate, cost: costs.reduce((sum, cost) => sum + cost, 0) };
  }).filter(candidate => Number.isFinite(candidate.cost));
  if (!evaluated.length) throw new RangeError('No feasible musical idea.');
  const ranked = evaluated.map(candidate => {
    const u = Math.max(Number.MIN_VALUE, random(seed, 'evaluated-idea', address, candidate.id));
    return { candidate, rank: candidate.cost + temperature * Math.log(-Math.log(u)) };
  }).sort((a, b) => a.rank - b.rank || (a.candidate.id < b.candidate.id ? -1 : 1));
  return structuredClone({ ...ranked[0].candidate, candidates: evaluated.length });
}

/** Independent continuous axes. These describe musical relationships, not
 * artist/genre switches. Coarse intentions dominate; fine details are bounded. */
export type MusicalSpectrum = Record<'energy' | 'activity' | 'ideaDensity' | 'ensembleSize' | 'register', number>;
export const SPECTRUM_AXES = ['energy', 'activity', 'ideaDensity', 'ensembleSize', 'register'] as const;
const clamp = (value: number) => Math.max(0, Math.min(1, value));

/** Smooth multiscale field with a separate reusable idea set at every depth.
 * Shared endpoints guarantee continuity. Each extra level contributes at
 * most 2^-depth of the coarsest motion; there is no per-frame resampling. */
export function spectrumHierarchy(seed: string, identity: string, depth = 3): IdeaGraph<MusicalSpectrum> {
  if (!Number.isInteger(depth) || depth < 0 || depth > 8) throw new RangeError('Spectrum depth must be between zero and eight.');
  const sets: IdeaSet<MusicalSpectrum>[] = [{ id: 'piece:palette', ideas: [{ id: 'piece:identity',
    value: Object.fromEntries(SPECTRUM_AXES.map(axis => [axis, random(seed, 'spectrum-piece', axis)])) as MusicalSpectrum }] }];
  const scopes: IdeaScope[] = [{ id: 'piece', sets: ['piece:palette'] }];
  for (let level = 0; level <= depth; level++) {
    const id = `${identity}:level-${level}`;
    sets.push({ id, ideas: Array.from({ length: 2 ** level + 1 }, (_, point) => ({
      id: `${id}:${point}`, value: Object.fromEntries(SPECTRUM_AXES.map(axis =>
        [axis, random(seed, 'spectrum-idea', identity, level, point, axis)])) as MusicalSpectrum,
    })) });
    scopes.push({ id, parents: level ? [`${identity}:level-${level - 1}`] : ['piece'], sets: [id] });
  }
  return new IdeaGraph({ sets, scopes });
}

const spectrumSources = new WeakMap<IdeaGraph<MusicalSpectrum>, Map<string, Map<string, MusicalSpectrum>>>();
export function spectrumAt(graph: IdeaGraph<MusicalSpectrum>, identity: string, phase: number, depth = 3): MusicalSpectrum {
  if (!Number.isFinite(phase)) throw new RangeError('A spectrum needs a finite position.');
  const scope = `${identity}:level-${depth}`;
  let scopes = spectrumSources.get(graph);
  if (!scopes) { scopes = new Map(); spectrumSources.set(graph, scopes); }
  let ideas = scopes.get(scope);
  if (!ideas) { ideas = new Map(graph.resolve(scope).map(idea => [idea.id, idea.value])); scopes.set(scope, ideas); }
  const piece = ideas.get('piece:identity')!;
  const result = Object.fromEntries(SPECTRUM_AXES.map(axis => [axis, .5 + (piece[axis] - .5) * .35])) as MusicalSpectrum;
  for (let level = 0; level <= depth; level++) {
    const position = clamp(phase) * 2 ** level, left = Math.min(2 ** level - 1, Math.floor(position));
    const t = position - left, smooth = t * t * (3 - 2 * t);
    const a = ideas.get(`${identity}:level-${level}:${left}`)!, b = ideas.get(`${identity}:level-${level}:${left + 1}`)!;
    for (const axis of SPECTRUM_AXES) result[axis] += ((a[axis] + (b[axis] - a[axis]) * smooth) - .5) * 2 ** -level;
  }
  for (const axis of SPECTRUM_AXES) result[axis] = clamp(result[axis]);
  return result;
}
