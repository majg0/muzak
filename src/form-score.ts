import { random } from './engine/random';
import type { FormRole } from './conductor';
import { chooseIdea, spectrumAt, spectrumHierarchy, type IdeaGraph, type MusicalSpectrum } from './engine/idea-graph';

export type FormStrategy = 'long-wave' | 'block-contrast' | 'surge-and-release' | 'terraced' | 'spotlight';
export interface SectionBehavior {
  strategy: FormStrategy;
  contour: 'arch' | 'plateau' | 'rise' | 'fall' | 'surge';
  entry: 'flow' | 'cut';
  ending?: 'open' | 'closed';
  phase?: 'prepare' | 'arrive' | 'settle' | 'continue';
  /** Absolute section index in FormState; local ordinal while planning. */
  destinationSection?: number;
  transitionBars?: number;
  energy: number;
  activity: number;
  ideaDensity: number;
  ensembleSize: number;
  register: number;
  /** The evaluated shared spectral field responsible for this destination. */
  ideaScope?: string;
  proposalCost?: number;
}
export type OpeningGesture = 'attack' | 'soliloquy' | 'drive' | 'swarm' | 'air' | 'panorama';
const OPENINGS: OpeningGesture[] = ['attack', 'soliloquy', 'drive', 'swarm', 'air', 'panorama'];
const clamp = (n: number) => Math.max(0, Math.min(1, n));
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
export const openingGesture = (seed: string, cycle = 0): OpeningGesture => OPENINGS[Math.floor(random(seed, 'formal-opening', cycle) * OPENINGS.length)];

/** Delivery belongs to the musical argument, not to a role-name preset.
 * An exposition can arrive at full force, on one exposed voice, or through
 * a broad slow chord. Returns preserve the family while changing its dress.
 * Independent addressed axes keep loudness, speed, idea count and ensemble
 * size from being synonyms. Choices last a whole section, never a frame. */
function rawBehavior(seed: string, cycle: number, ordinal: number, role: FormRole, freedom: number,
  field: IdeaGraph<MusicalSpectrum>, count: number): SectionBehavior {
  const breadth = clamp((freedom - .45) / .35);
  const draw = (axis: string) => random(seed, 'formal-delivery', cycle, ordinal, axis);
  const baseline = ({ intro: .14, theme: .43, answer: .54, development: .74, climax: .97, breakdown: .045, return: .34 })[role];
  const identity = `journey-${cycle}`, phase = ordinal / Math.max(1, count - 1);
  // Choose a destination near the inherited trajectory. Formal function is
  // an objective; it never substitutes a canned sequence of section vectors.
  const decision = chooseIdea(seed, `${identity}:section-${ordinal}`, Array.from({ length: 9 }, (_, candidate) => {
    const offset = (candidate - 4) / Math.max(8, count * 4);
    const value = spectrumAt(field, identity, clamp(phase + offset));
    return { id: `${identity}:position-${candidate}`, value, costs: {
      continuity: Math.abs(offset) * 2,
      function: Math.abs(value.energy - baseline) * (.45 + (1 - breadth)),
    } };
  }), .025 * breadth);
  let { energy, activity, ideaDensity, ensembleSize, register } = decision.value;
  const before = spectrumAt(field, identity, clamp(phase - .08));
  const after = spectrumAt(field, identity, clamp(phase + .08));
  const slope = after.energy - before.energy;
  // Labels describe the resulting relationships; they select no presets.
  const strategy: FormStrategy = Math.abs(activity - ensembleSize) > .4 ? 'spotlight'
    : Math.abs(slope) > .22 ? 'block-contrast' : energy - (before.energy + after.energy) / 2 > .03 ? 'surge-and-release'
      : Math.abs(slope) < .055 ? 'terraced' : 'long-wave';
  let contour: SectionBehavior['contour'] = Math.abs(slope) < .04 ? 'plateau'
    : slope > 0 ? 'rise' : 'fall';
  let entry: SectionBehavior['entry'] = 'flow';
  // Formal arrival and withdrawal remain meaningful, but an arrival can be
  // a broad orchestral chord instead of obligatory rapid melody everywhere.
  if (role === 'climax') {
    energy = .95 + draw('energy') * .05; ensembleSize = .84 + draw('ensemble') * .16;
    activity = .82 + draw('activity') * .17; register = .77 + draw('register') * .2;
    contour = Math.abs(slope) < .1 ? 'plateau' : 'arch';
  } else if (role === 'breakdown') {
    energy = .018 + draw('energy') * .035; activity = .03 + draw('activity') * .08;
    ensembleSize = draw('ensemble') * .12; ideaDensity = .025 + draw('ideas') * .12;
    register = .22 + draw('register') * .15; contour = 'plateau';
  }
  if (cycle === 0 && ordinal === 0 && role !== 'breakdown') {
    const opening = openingGesture(seed, cycle);
    const recipe: Record<OpeningGesture, readonly [number, number, number, number, number, SectionBehavior['contour']]> = {
      attack: [.96, .97, .86, .96, .66, 'plateau'],
      soliloquy: [.36, .2, .12, .015, .62, 'plateau'],
      drive: [.84, .89, .24, .65, .3, 'plateau'],
      swarm: [.88, .98, .96, .76, .84, 'surge'],
      air: [.11, .085, .06, .2, .43, 'rise'],
      panorama: [.66, .2, .15, .97, .79, 'arch'],
    };
    [energy, activity, ideaDensity, ensembleSize, register, contour] = recipe[opening];
    entry = opening === 'air' ? 'flow' : 'cut';
  }
  return { strategy, contour, entry: breadth >= .65 ? entry : 'flow', ideaScope: `${identity}:level-3`, proposalCost: decision.cost,
    energy: mix(baseline, energy, breadth), activity: mix(.035 + baseline * .95, activity, breadth),
    ideaDensity: mix(.12 + baseline * .66, ideaDensity, breadth),
    ensembleSize: mix(.12 + baseline * .8, ensembleSize, breadth),
    register: mix(.19 + baseline * .65, register, breadth) };
}

const AXES = ['energy', 'activity', 'ideaDensity', 'ensembleSize', 'register'] as const;
const smooth = (n: number) => n * n * (3 - 2 * n);

/** Compose destinations first, then spend intervening sections preparing or
 * releasing them. These are shared vectors, not independent per-role rerolls.
 * A theme can hand off before resolution; the final return still settles the
 * narrative. Local ornaments never change these multi-section obligations. */
export function planSectionBehaviors(seed: string, cycle: number, roles: readonly FormRole[], freedom: number): SectionBehavior[] {
  const field = spectrumHierarchy(seed, `journey-${cycle}`);
  const raw = roles.map((role, ordinal) => rawBehavior(seed, cycle, ordinal, role, freedom, field, roles.length));
  if (!raw.length) return [];
  const last = raw.length - 1, peak = roles.indexOf('climax');
  const goals = new Set<number>([0, last]);
  if (peak > 0) goals.add(peak);
  // A second destination gives the first half an actual direction, without
  // turning each of its sections into a new climax. Some long-wave narratives
  // instead carry a single broad preparation all the way to their main peak.
  const travel = raw.slice(1).reduce((sum, value, index) => sum + Math.abs(value.energy - raw[index].energy), 0);
  if (peak > 3 && travel > .45) {
    goals.add(Math.max(2, Math.min(peak - 2, 2 + Math.floor(random(seed, 'formal-secondary-position', cycle) * 3))));
  }
  roles.forEach((role, index) => { if (role === 'climax' || role === 'breakdown' || role === 'return') goals.add(index); });
  const ordered = [...goals].sort((a, b) => a - b);
  return raw.map((original, index) => {
    const destination = ordered.find(goal => goal >= index) ?? last;
    const previous = [...ordered].reverse().find(goal => goal < destination) ?? 0;
    const target = raw[destination], origin = raw[previous];
    const fraction = destination === previous ? 1 : (index - previous) / (destination - previous);
    const progress = smooth(fraction);
    const atGoal = index === destination;
    const falling = target.energy < origin.energy - .08;
    const phase: NonNullable<SectionBehavior['phase']> = atGoal
      ? roles[index] === 'breakdown' || roles[index] === 'return' ? 'settle' : index === 0 ? 'continue' : 'arrive'
      : falling ? 'settle' : 'prepare';
    const result: SectionBehavior = { ...original, entry: 'flow', phase, destinationSection: destination,
      transitionBars: 2.5 + random(seed, 'formal-transition-width', cycle, destination) * 1.5 };
    for (const axis of AXES) result[axis] = atGoal ? target[axis] : mix(origin[axis], target[axis], progress);
    // Preparation has direction; it does not restart an arch in every section.
    if (!atGoal) result.contour = falling ? 'fall' : 'rise';
    if (index === 0 && cycle === 0) result.entry = original.entry;
    else if (index >= 2 && index < last && atGoal && freedom > .75
      && Math.abs(raw[index].energy - raw[index - 1].energy) > .35
      && random(seed, 'formal-exceptional-cut', cycle, index) < .075) result.entry = 'cut';
    result.ending = roles[index] === 'return' || roles[index] === 'breakdown' ? 'closed'
      : ['intro', 'answer', 'development'].includes(roles[index]) || !atGoal ? 'open'
        : random(seed, 'formal-ending', cycle, index) < (roles[index] === 'climax' ? .7 : .35) ? 'closed' : 'open';
    return result;
  });
}
