import { chooseIdea, type EvaluatedIdea, type IdeaDecision } from './idea-graph';
import { random } from './random';

export interface IdeaPlan {
  /** A stable musical scope and its committed occurrence, never a query count. */
  scope: string; ordinal: number; vocabulary: readonly string[]; maxRegret: number;
}
export interface ToolCoverage {
  focus: string; eligible: string[]; used: string[]; deferred: string[]; fulfilled: boolean;
}
export interface PlannedIdea<T> extends EvaluatedIdea<T> { tools: readonly string[]; }
export interface PlannedIdeaChoice<T> extends IdeaDecision<T> { tools: readonly string[]; coverage?: ToolCoverage; }

/** Each vocabulary member owns one opportunity per cycle. The order depends
 * only on piece identity and scope, so lookahead and cache eviction cannot
 * consume opportunities or rewrite a committed choice. */
export function vocabularyFocus(seed: string, plan: IdeaPlan): string {
  if (!plan.scope || !Number.isSafeInteger(plan.ordinal) || plan.ordinal < 0
    || !Number.isFinite(plan.maxRegret) || plan.maxRegret < 0
    || !plan.vocabulary.length || plan.vocabulary.length > 128
    || plan.vocabulary.some(tool => !tool) || new Set(plan.vocabulary).size !== plan.vocabulary.length)
    throw new RangeError('An idea plan needs a scope, nonnegative occurrence/budget and unique bounded vocabulary.');
  const ordered = [...plan.vocabulary].sort((a, b) =>
    random(seed, 'vocabulary-order', plan.scope, a) - random(seed, 'vocabulary-order', plan.scope, b)
    || (a < b ? -1 : a > b ? 1 : 0));
  // Rotate at every enclosing cycle as well as within it. A reply that enters
  // every third/ninth thought must not alias the same three/nine tool slots.
  if (ordered.length === 1) return ordered[0];
  let position = plan.ordinal, phase = 0;
  while (position) { phase = (phase + position % ordered.length) % ordered.length; position = Math.floor(position / ordered.length); }
  return ordered[phase];
}

/** Share one evaluator across domains. Long-form intent selects among complete
 * feasible alternatives within an explicit musical cost budget. An unavailable
 * tool is deferred and never credited as used. No state grows with performance
 * length; repeated or out-of-order queries produce the same answer. */
export function choosePlannedIdea<T>(seed: string, address: string, candidates: readonly PlannedIdea<T>[],
  plan?: IdeaPlan, temperature = 0): PlannedIdeaChoice<T> {
  if (!plan) return chooseIdea(seed, address, candidates, temperature) as PlannedIdeaChoice<T>;
  const best = chooseIdea(seed, address, candidates);
  const focus = vocabularyFocus(seed, plan);
  const admitted = candidates.filter(candidate => Object.values(candidate.costs).reduce((sum, value) => sum + value, 0)
    <= best.cost + plan.maxRegret + 1e-12);
  const eligible = [...new Set(admitted.flatMap(candidate => candidate.tools))].sort();
  const focused = admitted.filter(candidate => candidate.tools.includes(focus));
  // Even tie-breaking temperature stays inside the declared regret bound.
  const chosen = chooseIdea(seed, address, focused.length ? focused : admitted, temperature) as PlannedIdeaChoice<T>;
  return { ...chosen, candidates: best.candidates,
    coverage: { focus, eligible, used: [...new Set(chosen.tools)].sort(),
      deferred: plan.vocabulary.filter(tool => !eligible.includes(tool)).sort(), fulfilled: chosen.tools.includes(focus) } };
}
