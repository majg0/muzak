import type { PhraseRest } from '../phrasing';
import type { NoteEvent, Parameters } from '../types';
import { subdivideBetweenTargets, thematicCell, type SubdividedAttack } from './idea-kernel';

export interface TransitionBoundary {
  id: string;
  tick: number;
  kind: 'section' | 'meter' | 'tempo';
  strength?: number;
  themeId?: string;
}
export interface TransitionPlan {
  boundaryTick: number;
  startTick: number;
  endTick: number;
  kind: TransitionBoundary['kind'];
  gesture: 'pickup' | 'fill' | 'roll' | 'release';
  reason: string;
  energy: number;
  notes: NoteEvent[];
  rests: PhraseRest[];
  sourceId?: string;
  hierarchy?: SubdividedAttack[];
}

const unit = (value: number) => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
const round = (value: number) => Math.round(value * 1e6) / 1e6;
const preparationCache = new Map<string, SubdividedAttack[]>();

function preparationFor(seed: string, boundary: TransitionBoundary, start: number, end: number,
  p: Parameters, energy: number, sparse: boolean, fast: boolean): SubdividedAttack[] {
  const cell = thematicCell(seed, boundary.themeId ?? boundary.id);
  const key = JSON.stringify([seed, cell.id, boundary.id, boundary.tick, start, end, p.rhythmicComplexity,
    p.rhythmicPredictability, energy, sparse, fast]);
  const prior = preparationCache.get(key); if (prior) return prior;
  if (end <= start) return [];
  const cellTicks = cell.units * 120, anchors: { tick: number; strength: number }[] = [];
  for (let origin = boundary.tick - cellTicks; origin + cellTicks > start; origin -= cellTicks)
    for (const attack of cell.attacks) {
      const tick = origin + attack.unit * 120;
      if (tick >= start && tick < end) anchors.push({ tick, strength: attack.strength });
    }
  anchors.sort((a, b) => a.tick - b.tick);
  let result: SubdividedAttack[];
  if (sparse) {
    // A genuinely small pickup quotes only the final one to three source
    // landmarks. Its spacing is inherited, not an obligatory eighth pattern.
    const count = Math.min(3, Math.max(1, Math.ceil(energy * 8)));
    const chosen = anchors.slice(-count);
    if (!chosen.length) chosen.push({ tick: Math.max(start, end - 240), strength: .75 });
    result = chosen.map((attack, index) => ({ tick: attack.tick, durationTicks: (chosen[index + 1]?.tick ?? end) - attack.tick,
      strength: attack.strength, level: 'goal' }));
  } else {
    const span = end - start, split = start + Math.max(120, Math.floor(span / 240) * 120);
    const budget = Math.min(36, Math.max(4, Math.ceil(span / 480 * (.7 + energy * (2 + p.rhythmicComplexity * 3)))));
    result = [];
    // Reserve most detail for the destination half. Both halves preserve their
    // source targets, but subdivisions grow into the arrival instead of using
    // a fixed eighth/sixteenth/32nd recipe at every section.
    for (let phase = 0; phase < 2; phase++) {
      const from = phase ? split : start, to = phase ? end : Math.min(split, end);
      if (to <= from) continue;
      result.push(...subdivideBetweenTargets(seed, `${boundary.id}:source:${cell.id}:preparation:${phase}`, {
        startTick: from, endTick: to, gridTicks: fast && phase ? 60 : 120,
        attackBudget: Math.max(1, Math.round(budget * (phase ? .77 : .23))),
        anchors: anchors.filter(attack => attack.tick >= from && attack.tick < to),
        pulseTicks: 480, originTick: boundary.tick, direction: 1,
        syncopation: .12 + (1 - p.rhythmicPredictability) * .45,
      }));
    }
    result.sort((a, b) => a.tick - b.tick);
    result = result.map((attack, index) => ({ ...attack, durationTicks: (result[index + 1]?.tick ?? end) - attack.tick }));
  }
  preparationCache.set(key, result);
  if (preparationCache.size > 256) preparationCache.delete(preparationCache.keys().next().value!);
  return result;
}

/** Only boundaries already known to the performance belong here. A plan uses
 * at most eight quarter notes of preparation, and integer musical time; a
 * newly recorded tempo edit cannot alter notes committed before it was known.
 * Several reasons at one boundary make one arrival, not stacked drum fills.
 * The caller should supply nearby boundaries and expose these accompaniment
 * rests in the frame snapshot so live held voices observe the same breath. */
export function planTransitions(seed: string, boundaries: readonly TransitionBoundary[], p: Parameters, amount: number): TransitionPlan[] {
  const transition = unit(amount);
  if (transition === 0 || p.rhythmicDensity <= .06) return [];
  const distinct = new Map<number, TransitionBoundary>();
  const priority = { section: 0, meter: 1, tempo: 2 };
  for (const boundary of boundaries) {
    if (!Number.isSafeInteger(boundary.tick) || boundary.tick <= 0 || unit(boundary.strength ?? 1) === 0) continue;
    const previous = distinct.get(boundary.tick);
    if (!previous || priority[boundary.kind] > priority[previous.kind] || priority[boundary.kind] === priority[previous.kind] && boundary.id < previous.id) distinct.set(boundary.tick, boundary);
  }
  const ordered = [...distinct.values()].sort((a, b) => a.tick - b.tick);
  return ordered.map((boundary, index) => {
    const strength = unit(boundary.strength ?? 1);
    const energy = unit(transition * (.45 + .55 * unit(p.rhythmicDensity)) * strength);
    const sparse = transition <= .3 || energy < .18;
    const buildupTicks = sparse ? 960 : 480 * (4 + Math.round(transition * 4));
    // A nearer arrival owns its own preparation. Dense explicit tempo edits
    // do not leave overlapping simultaneous rolls in the same drum voice.
    const previousArrival = ordered[index - 1]?.tick ?? 0;
    const startTick = Math.max(previousArrival, boundary.tick - buildupTicks);
    const breathTicks = transition >= .25 ? transition > .65 ? 120 : 60 : 0;
    const breathStart = Math.max(startTick, boundary.tick - breathTicks);
    const notes: NoteEvent[] = [];
    const fastRoll = transition > .6 && p.rhythmicComplexity > .45 && p.rhythmicDensity > .18;
    const hierarchy = preparationFor(seed, boundary, startTick, breathStart, p, energy, sparse, fastRoll);
    for (const attack of hierarchy) {
      const { tick } = attack, progress = (tick - startTick) / Math.max(1, boundary.tick - startTick);
      const midiNote = attack.level === 'goal' && progress > .35 ? 36
        : attack.level === 'subdivision' && attack.strength < .48 ? 42 : 38;
      const velocity = unit((.2 + progress * .36) * (.64 + attack.strength * .36)
        * (.55 + p.dynamics * .5) * (.55 + transition * .45) * strength);
      notes.push({ id: `transition:${boundary.id}:${tick}:${midiNote}`, tick,
        duration: Math.max(1, Math.min(midiNote === 42 ? 60 : 90, breathStart - tick)), midiNote,
        voice: 9, part: 'percussion', velocity: round(velocity), expression: { role: 'support', sourceId: boundary.id } });
    }
    for (const midiNote of transition > .65 ? [36, 42] : [36]) {
      notes.push({ id: `transition:${boundary.id}:${boundary.tick}:${midiNote}`, tick: boundary.tick, duration: midiNote === 36 ? 150 : 90,
        midiNote, voice: 9, part: 'percussion', velocity: round(unit((midiNote === 36 ? .62 : .42) * (.7 + p.dynamics * .4) * (.65 + transition * .35) * strength)),
        expression: { role: 'anchor', sourceId: boundary.id } });
    }
    const reason = boundary.kind === 'tempo' ? 'Prepare the known tempo change, breathe, then land.'
      : boundary.kind === 'meter' ? 'Gather the pulse before the new meter.' : 'Build toward the next section and leave its entrance clear.';
    const preparation = notes.filter(note => note.tick < boundary.tick);
    const actualRoll = preparation.some((note, index) => index > 0 && note.tick - preparation[index - 1].tick === 60);
    const gesture: TransitionPlan['gesture'] = !preparation.length ? 'release' : sparse ? 'pickup' : actualRoll ? 'roll' : 'fill';
    return { boundaryTick: boundary.tick, startTick, endTick: boundary.tick + 480, kind: boundary.kind, gesture, reason, energy: round(energy), notes,
      sourceId: thematicCell(seed, boundary.themeId ?? boundary.id).id, hierarchy,
      rests: breathTicks > 0 ? [{ startTick: breathStart, endTick: boundary.tick, scope: 'accompaniment' as const, reason: 'A brief breath before the prepared arrival.' }] : [] };
  });
}
