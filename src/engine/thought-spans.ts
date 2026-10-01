import type { FormState } from '../conductor';
import type { HarmonyConfig } from '../harmonic-language';
import { FRAME_TICKS, PPQ, type Parameters } from '../types';
import { random } from './random';
import type { ThemeCore } from './theme-core';

export interface ThoughtSpan { startTick: number; endTick: number; }

/** Allocate short complete arguments from the source's own pulse and groups.
 * Two to four active groups are a compositional budget, not a claim about
 * cognition. Sparse delivery buys a little breathing room, not many empty
 * bars. Development changes the proportions of statement and reply; only a
 * deliberately sparse, exploratory episode can earn a rare longer argument.
 * Literal occurrences retain equal full durations. The last one absorbs the
 * episode's exact remainder, including a partial frame in an asymmetric bar. */
export function planThoughtSpans(seed: string, form: Pick<FormState, 'sectionStartTick' | 'sectionEndTick' | 'sectionIndex' | 'barTicks'>
  & Partial<Pick<FormState, 'role'>>, core: ThemeCore,
  parameters: Parameters, development: number, treatment: HarmonyConfig['treatment']): ThoughtSpan[] {
  const ticks = form.sectionEndTick - form.sectionStartTick;
  if (![form.sectionStartTick, form.sectionEndTick, form.sectionIndex, form.barTicks].every(Number.isSafeInteger)
    || form.sectionStartTick < 0 || form.sectionIndex < 0 || form.barTicks < 1 || ticks < 4 * FRAME_TICKS)
    throw new RangeError('A musical episode needs integer coordinates and at least 3840 ticks for a complete argument.');
  if (![parameters.ideaDensity, development].every(Number.isFinite))
    throw new RangeError('Thought density and development must be finite.');
  const head = core.clauses.find(clause => clause.sourceId === core.headId)?.notes ?? core.clauses[0]?.notes;
  if (!head?.length || head.some(note => !Number.isFinite(note.rhythmUnits) || note.rhythmUnits <= 0))
    throw new RangeError('A musical argument needs a nonempty source with positive rhythmic durations.');
  const headWeight = head.reduce((sum, note) => sum + note.rhythmUnits, 0);
  const pulseUnits = core.cell?.pulseUnits ?? 4, sourceUnits = core.cell?.units ?? headWeight;
  const groups = core.cell?.groups.length ? core.cell.groups : head.map(note => note.rhythmUnits);
  if (![pulseUnits, sourceUnits, ...groups].every(value => Number.isFinite(value) && value > 0))
    throw new RangeError('A musical source needs positive pulse, span and group durations.');
  const density = Math.max(0, Math.min(1, parameters.ideaDensity)), departure = Math.max(0, Math.min(1, development));
  const activeGroups = Math.max(2, Math.min(4, groups.length)), sourcePulses = sourceUnits / pulseUnits;
  const meanGroup = groups.reduce((sum, group) => sum + group, 0) / groups.length;
  const asymmetry = Math.min(1, groups.reduce((sum, group) => sum + Math.abs(group - meanGroup), 0) / sourceUnits);
  const ordinaryPulses = Math.max(8, Math.min(16, sourcePulses * (1 + activeGroups / 2) + 1 + (1 - density) + asymmetry));
  const extended = form.role === 'development' && departure > .85 && density < .25 && groups.length >= 3
    && random(seed, 'thought-extension', core.id, form.sectionIndex) < .08;
  // Count whole frames conservatively. A fractional ending belongs to the
  // final argument and must never round a complete earlier one below minimum.
  const total = Math.floor(ticks / FRAME_TICKS), minimum = 4;
  // This is a storage bound, independent of the number of simultaneously
  // active ideas. Long episodes may contain many short, related thoughts.
  const desired = Math.max(minimum, Math.ceil(total / 128), Math.round(ordinaryPulses * (extended ? 1.5 : 1) * PPQ / FRAME_TICKS));
  const fixed = treatment !== 'develop' || parameters.motifTransformation === 0 || parameters.motifRecurrence === 1;
  // Rounding up a literal count can leave nearly one frame per repetition
  // piled into the final thought. Round down to keep that ending below twice
  // a complete occurrence while retaining the same duration for all repeats.
  const count = Math.max(1, Math.min(128, Math.floor(total / minimum), fixed ? Math.floor(total / desired) : Math.round(total / desired)));
  if (count === 1) return [{ startTick: form.sectionStartTick, endTick: form.sectionEndTick }];

  const weights = Array.from({ length: count }, (_, index) => fixed ? 1
    : 1 + (Math.max(.5, Math.min(1.5, groups[index % groups.length] / meanGroup)) - 1) * .16
      + departure * .18 * (.5 - index / (count - 1)));
  const spans: ThoughtSpan[] = [];
  let cursor = form.sectionStartTick, remaining = total;
  // Exact repeats are allowed to establish identity. Development may compress
  // a reply or extend a new continuation; no leftover fragment is amputated.
  const full = Math.floor(total / count);
  for (let index = 0; index < count; index++) {
    const after = count - index - 1;
    const target = fixed ? full : Math.round(remaining * weights[index] / weights.slice(index).reduce((sum, weight) => sum + weight, 0));
    const length = after ? Math.max(minimum, Math.min(remaining - after * minimum, target)) : remaining;
    const endTick = index === count - 1 ? form.sectionEndTick : cursor + length * FRAME_TICKS;
    spans.push({ startTick: cursor, endTick }); cursor = endTick; remaining -= length;
  }
  return spans;
}
