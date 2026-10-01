import type { FormState } from '../conductor';
import { PPQ, type Parameters } from '../types';
import type { ExpressiveContour } from './expression';
import { random } from './random';
import type { RhythmicMoment } from './rhythmic-score';

export interface TextureIntent {
  pace: number;
  syncopation: number;
  subdivisionTicks: number;
  gateRatio: number;
  attackSoftness: number;
  rhythmDrive: number;
  velocityCeiling: number;
  articulation: 'sustained' | 'connected' | 'detached';
  /** Production score: the same source rhythm drives foreground and backing. */
  rhythm?: RhythmicMoment;
}
export type TextureAt = (tick: number) => TextureIntent;

/** A reusable shared attack grammar. The identity lasts eight four-beat
 * cycles; increasing drive admits finer members of the same rhythmic cell.
 * Different parts can quote it without restarting each other's clocks. */
export function texturePulseAt(seed: string, tick: number, texture: TextureIntent, origin = 0): number {
  if (texture.rhythm) return texture.rhythm.accents.find(note => note.tick === tick)?.strength ?? 0;
  const offset = tick - origin;
  if (offset < 0 || offset % texture.subdivisionTicks !== 0) return 0;
  const slot = Math.floor(offset / (PPQ / 4)) % 16;
  if (slot === 0) return 1;
  if (texture.pace < .3) return 0;
  const strength = slot % 4 === 0 ? .88 : slot % 2 === 0 ? .72 : .53;
  const chance = slot % 4 === 0 ? .55 + texture.rhythmDrive * .45
    : slot % 2 === 0 ? texture.rhythmDrive * .95 : texture.rhythmDrive * (.45 + texture.syncopation * .55);
  return random(seed, 'shared-texture-cell', Math.floor(offset / (PPQ * 32)), slot) < chance ? strength : 0;
}
const clamp = (n: number) => Math.max(0, Math.min(1, n));
const smooth = (n: number) => n * n * (3 - 2 * n);

/** One continuous performance policy shared by all parts. A grid describes
 * available subdivisions, not a finished pattern: pace admits attacks and
 * syncopation admits weak positions. Slow music changes its onset grammar and
 * articulation, while retaining an audible dynamic floor in final synthesis.
 * No rule changes the chosen tempo or creates pitches. */
export function textureIntentAt(p: Parameters, form: FormState, expression: ExpressiveContour): TextureIntent {
  const pace = clamp((expression.activity * .75 + p.rhythmicDensity * .15 + p.melodicActivity * .1 - .06) / .9);
  const energy = smooth(pace);
  const syncopation = clamp(p.rhythmicComplexity * (1 - p.metricStability * .65) * (.08 + energy * .92));
  const subdivisionTicks = pace < .3 ? PPQ : pace < .63 ? PPQ / 2 : Math.min(PPQ / 4, form.subdivisionTicks);
  return { pace, syncopation, subdivisionTicks,
    gateRatio: .75 + (1 - energy) * .65,
    attackSoftness: clamp(.9 - energy * .69 + p.voiceLeading * .08),
    rhythmDrive: clamp(energy * (.55 + p.rhythmicDensity * .3 + p.rhythmicComplexity * .15)),
    velocityCeiling: clamp(.5 + expression.intensity * .46 + p.dynamics * .035),
    articulation: pace < .3 ? 'sustained' : pace > .78 && p.voiceLeading < .72 ? 'detached' : 'connected' };
}
