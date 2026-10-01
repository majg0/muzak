import type { FormState } from '../conductor';
import type { Parameters } from '../types';
import { expressiveContourAt, type ExpressiveContour } from './expression';
import { textureIntentAt, type TextureIntent } from './texture';
import { random } from './random';

export interface CompositionExpression {
  expression: ExpressiveContour;
  texture: TextureIntent;
  parameters: Parameters;
}
const clamp = (value: number) => Math.max(0, Math.min(1, value));
const mix = (from: number, to: number, amount: number) => from + (to - from) * amount;
const round = (value: number) => Math.round(value * 1e6) / 1e6;
const logit = (value: number) => Math.log(value / (1 - value));
function modulatePreference(baseline: number, trajectory: number, pivot: number, breadth: number): number {
  if (baseline <= 0 || baseline >= 1 || breadth === 0) return clamp(baseline);
  const bounded = Math.max(.00001, Math.min(.99999, trajectory));
  const odds = logit(baseline) + breadth * (logit(bounded) - logit(pivot));
  return round(1 / (1 + Math.exp(-odds)));
}

/** One composition's performance reading, independent of autonomous-form
 * freedom. Long intensity arcs, shorter breaths and register direction are
 * related but not identical. Callers apply explicit automation AFTER these
 * mapped controls, and can derive textureIntentAt from those final controls.
 * Absolute musical time makes lookahead and replay use the same reading. */
export function compositionExpressionAt(seed: string, tick: number, base: Parameters,
  formAt: (tick: number) => FormState, breadth: number): CompositionExpression {
  const strength = Number.isFinite(breadth) ? clamp(breadth) : 0;
  const form = formAt(tick), full = expressiveContourAt(seed, tick, formAt, 1);
  const sectionProgress = clamp((tick - form.sectionStartTick) / Math.max(1, form.sectionEndTick - form.sectionStartTick));
  const phraseProgress = clamp((tick - form.phraseStartTick) / Math.max(1, form.phraseEndTick - form.phraseStartTick));
  // These vanish at section boundaries, where both neighboring sections must
  // agree. They also cross each thought boundary continuously instead of
  // restarting a crescendo from a new local zero.
  const interior = Math.sin(Math.PI * sectionProgress) ** 2;
  const breath = Math.sin(Math.PI * 2 * phraseProgress) * interior;
  const destination = form.behavior?.destinationSection ?? form.sectionIndex;
  const registerReading = Math.sin(Math.PI * 2 * sectionProgress
    + random(seed, 'composition-expression', destination, 'register') * Math.PI * 2) * interior;
  const rhythmicReading = (random(seed, 'composition-expression', destination, 'rhythm') - .5) * interior;
  const pull = (value: number) => mix(.5, clamp(value), strength);
  const expression: ExpressiveContour = {
    energy: pull(full.energy), intensity: pull(full.intensity),
    activity: pull(full.activity + breath * .075 + rhythmicReading * .08),
    register: pull(full.register + registerReading * .08),
    sustain: pull(full.sustain - breath * .08), accent: pull(full.accent + breath * .07),
    ideaDensity: pull(full.ideaDensity ?? full.activity), ensembleSize: pull(full.ensembleSize ?? full.energy),
    direction: strength === 0 ? 'settled' : full.direction,
  };
  const parameters = { ...base };
  const set = (key: Exclude<keyof Parameters, 'tempo'>, target: number, influence = 1) => {
    parameters[key] = round(clamp(mix(base[key], clamp(target), strength * influence)));
  };
  if (strength > 0) {
    set('dynamics', .23 + full.intensity * .73);
    set('rhythmicDensity', .045 + clamp(full.activity + breath * .075 + rhythmicReading * .08) * .91);
    set('melodicActivity', .05 + clamp((full.ideaDensity ?? full.activity) * .65 + full.activity * .35 + breath * .08) * .9, .88);
    // Shape the preference, rather than replacing it. Literal endpoints remain
    // sparse/dense and solo/tutti at every breadth; the default midpoint follows
    // the complete authored range. Explicit automation still runs afterwards.
    parameters.ideaDensity = modulatePreference(base.ideaDensity, clamp((full.ideaDensity ?? full.activity) + breath * .04), .5, strength);
    parameters.ensembleSize = modulatePreference(base.ensembleSize, full.ensembleSize ?? full.energy, .55, strength);
    set('texturalDensity', .08 + (full.ensembleSize ?? full.energy) * .86);
    set('brightness', .21 + clamp(full.register + registerReading * .08) * .77);
    set('rhythmicComplexity', .1 + full.activity * .67 + breath * .05, .8);
    set('metricStability', .98 - full.activity * .32, .6);
    set('bassMobility', .1 + full.activity * .73, .8);
    set('harmonicMobility', .18 + full.energy * .68 + registerReading * .12, .65);
    // Emotional intensity does not require dense chromatic clusters. Harmonic
    // tension retains the composer's baseline and its own slower contour.
    set('tension', .08 + full.energy * .78, .65);
    set('dissonance', .07 + full.energy * .28, .3);
    set('tonalClarity', .92 - full.energy * .27, .25);
  }
  return { expression, parameters, texture: textureIntentAt(parameters, form, expression) };
}
