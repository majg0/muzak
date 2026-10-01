import type { FormRole, FormState } from '../conductor';
import { random } from './random';

export interface ExpressiveContour {
  energy: number;
  activity: number;
  intensity: number;
  register: number;
  sustain: number;
  accent: number;
  ideaDensity?: number;
  ensembleSize?: number;
  direction: 'gathering' | 'cresting' | 'receding' | 'settled';
}

const clamp = (value: number) => Math.max(0, Math.min(1, value));
const mix = (from: number, to: number, amount: number) => from + (to - from) * amount;
const smooth = (value: number) => value * value * (3 - 2 * value);
const ROLE_ENERGY: Record<FormRole, readonly [number, number, number]> = {
  intro: [.17, .06, .3], theme: [.43, .25, .64], answer: [.54, .35, .72],
  development: [.74, .57, .9], climax: [.97, .91, 1],
  breakdown: [.045, .012, .095], return: [.34, .19, .53],
};

function sectionEnergy(seed: string, form: FormState): number {
  if (form.behavior) return form.behavior.energy;
  const [middle, low, high] = ROLE_ENERGY[form.role];
  const identity = (random(seed, 'expressive-story', 'energy') - .5) * .18;
  const reading = (random(seed, 'expressive-section', form.sectionIndex, 'energy') - .5) * .16;
  return Math.max(low, Math.min(high, middle + identity + reading));
}

/** A shared absolute-time expressive plan. Flowing neighbors agree on their
 * boundary; an explicitly composed cut keeps the preceding statement intact
 * until the next downbeat. Asymmetric seeded knots create a multi-bar approach,
 * crest, plateau or release without restarting at a foreground thought boundary.
 * All dimensions are centered on .5: callers map their deviations onto their
 * own musical controls. This function never chooses or changes the tempo. */
export function expressiveContourAt(seed: string, tick: number, formAt: (tick: number) => FormState, amount = 1): ExpressiveContour {
  if (!Number.isSafeInteger(tick) || tick < 0) throw new RangeError('Expression needs a non-negative integer musical tick.');
  const strength = Number.isFinite(amount) ? clamp(amount) : 1;
  if (strength === 0) return { energy: .5, activity: .5, intensity: .5, register: .5, sustain: .5, accent: .5, ideaDensity: .5, ensembleSize: .5, direction: 'settled' };
  const form = formAt(tick), next = formAt(form.sectionEndTick);
  const previous = form.sectionStartTick > 0 ? formAt(form.sectionStartTick - 1) : undefined;
  const address = form.sectionIndex;
  const contour = form.behavior?.contour ?? 'arch';
  const sectionBars = (form.sectionEndTick - form.sectionStartTick) / form.barTicks;
  // Keep every internal leg broad too. Enlarging only the outer ramps can
  // squeeze a surge's middle into a fraction of a bar in a short episode.
  const transition = Math.max(.2, Math.min(.3, (form.behavior?.transitionBars ?? 3) / sectionBars));
  const positions = [0, transition, .5, 1 - transition, 1];
  const progress = clamp((tick - form.sectionStartTick) / Math.max(1, form.sectionEndTick - form.sectionStartTick));
  let segment = 0;
  while (segment + 1 < positions.length - 1 && progress >= positions[segment + 1]) segment++;
  const width = positions[segment + 1] - positions[segment];
  const local = clamp((progress - positions[segment]) / width);
  type Dimension = 'energy' | 'activity' | 'ideaDensity' | 'ensembleSize' | 'register';
  const targetAt = (state: FormState, key: Dimension): number => {
    if (state.behavior) return state.behavior[key];
    const energy = sectionEnergy(seed, state);
    return key === 'energy' ? energy : key === 'activity' ? .035 + energy * .95
      : key === 'ideaDensity' ? .12 + energy * .66 : key === 'ensembleSize' ? .12 + energy * .8 : .19 + smooth(energy) * .65;
  };
  const valuesFor = (key: Dimension): number[] => {
    const target = targetAt(form, key), destination = targetAt(next, key);
    const cut = form.behavior?.entry === 'cut', nextCut = next.behavior?.entry === 'cut';
    const entrance = cut ? target : previous ? mix(targetAt(previous, key), target, .65) : target * .6;
    const exit = nextCut ? target : mix(target, destination, .65);
    const preparing = (form.behavior?.destinationSection ?? form.sectionIndex) > form.sectionIndex;
    if (preparing) return [entrance, mix(entrance, exit, .25), mix(entrance, exit, .5), mix(entrance, exit, .75), exit];
    if (contour === 'plateau') return [entrance, target, target, mix(target, exit, .5), exit];
    if (contour === 'rise') return [entrance, mix(entrance, target, .3), target, mix(target, exit, .4), exit];
    if (contour === 'fall') return [entrance, target, mix(target, exit, .35), mix(target, exit, .72), exit];
    if (contour === 'surge') return [entrance, target, target * .84, mix(target, exit, .5), exit];
    // A broad ensemble can remain broad through a melodic breath, and an
    // exposed fast solo need not summon every player at its local emphasis.
    const expressive = key === 'energy' || key === 'activity';
    return [entrance, target * (expressive ? .82 + random(seed, 'expressive-section', address, 'gather') * .08 : .96),
      clamp(target + (expressive ? (random(seed, 'expressive-section', address, 'emphasis') - .35) * .045 : 0)),
      nextCut ? target : mix(target, destination, .35), exit];
  };
  const reading = (key: Dimension): number => {
    const values = valuesFor(key);
    if ((form.behavior?.destinationSection ?? form.sectionIndex) > form.sectionIndex) return mix(values[0], values[4], smooth(progress));
    return mix(values[segment], values[segment + 1], smooth(local));
  };
  const energy = reading('energy'), activity = reading('activity'), values = valuesFor('energy');
  const slope = (form.behavior?.destinationSection ?? form.sectionIndex) > form.sectionIndex
    ? (values[4] - values[0]) * 6 * progress * (1 - progress)
    : (values[segment + 1] - values[segment]) * 6 * local * (1 - local) / width;
  const pull = (value: number) => clamp(mix(.5, value, strength));
  return {
    // Intensity has a soft floor and an expansive crest. This is the requested
    // performance shape; audible intensity is measured separately from notes.
    energy: pull(energy), intensity: pull(smooth(energy)), activity: pull(activity),
    ideaDensity: pull(reading('ideaDensity')), ensembleSize: pull(reading('ensembleSize')),
    register: pull(reading('register')), sustain: pull(.99 - activity * .76),
    accent: pull(.16 + energy * .48 + activity * .3),
    direction: slope > .018 ? 'gathering' : slope < -.018 ? 'receding' : energy > .75 ? 'cresting' : 'settled',
  };
}
