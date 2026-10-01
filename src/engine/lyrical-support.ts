import type { FormState } from '../conductor';
import { TUNINGS, type TuningId } from '../pitch';
import { nativeSpace } from './native-space';
import { FRAME_TICKS, PPQ } from '../types';
import type { TextureIntent } from './texture';
import type { HarmonyConfig } from '../harmonic-language';
import { harmonicWindowTicks, type MelodyAnchor } from './harmonic-tools';

export interface LyricalHarmonyWindow { startTick: number; endTick: number; }

/** Harmonic windows keep a whole-bar duration aligned to planner commits.
 * A supplied committed thought owns the clock's origin and can close its
 * final window early; standalone callers retain section-bar alignment. */
export function lyricalHarmonyWindow(form: FormState, config?: HarmonyConfig, scope?: LyricalHarmonyWindow): LyricalHarmonyWindow {
  const span = harmonicWindowTicks(form.barTicks, config);
  const origin = scope?.startTick ?? form.sectionStartTick;
  const startTick = origin + Math.max(0, Math.floor((form.barStartTick - origin) / span)) * span;
  return { startTick, endTick: Math.min(scope?.endTick ?? form.sectionEndTick, startTick + span) };
}

/** The melodic sentence owns the foreground at every expressive level.
 * A crest broadens the sustained bed; it does not create another fast lead. */
export function lyricalTexture(base: TextureIntent): TextureIntent {
  return { ...base, pace: .12 + base.pace * .12, syncopation: Math.min(.055, base.syncopation * .12),
    subdivisionTicks: PPQ, gateRatio: 1.4, attackSoftness: Math.max(.88, base.attackSoftness),
    rhythmDrive: Math.min(.1, base.rhythmDrive * .12), articulation: 'sustained' };
}

const FIELDS = {
  '12tet': { major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10] },
  '19edo': { major: [0, 3, 6, 8, 11, 14, 17], minor: [0, 3, 5, 8, 11, 13, 16] },
  // Quarter-tone colors use complementary wide/narrow thirds (450/250c).
  // These labels select a polarity; they do not assert common-practice function.
  '24edo': { major: [0, 4, 9, 10, 14, 19, 23], minor: [0, 4, 5, 10, 14, 15, 20] },
  '31edo': { major: [0, 5, 10, 13, 18, 23, 28], minor: [0, 5, 8, 13, 18, 21, 26] },
} as const;

/** Each field is an explicitly chosen native collection, not rounded source
 * notes or a claim that all tunings have identical harmonic behavior. */
export function lyricalField(tuning: TuningId, third: 3 | 4 = 4): readonly number[] {
  return FIELDS[tuning][third === 3 ? 'minor' : 'major'];
}

const mod = (value: number, period: number) => ((value % period) + period) % period;
export function inLyricalField(upper: readonly number[], bass: number, center: number, tuning: TuningId, third: 3 | 4 = 4): boolean {
  const field = lyricalField(tuning, third), period = TUNINGS[tuning].divisions;
  return [...upper, bass].every(pitch => field.includes(mod(pitch - center, period)));
}

/** A held lead needs room in its actual register. Penalize only a close
 * physical neighbor around a semitone, not every extension or non-chord tone
 * elsewhere in the spectrum. Targets are the phrase's declared held tones. */
export function lyricalNeighborPenalty(upperCents: readonly number[], targetsCents: readonly number[]): number {
  if (!targetsCents.length) return 0;
  const neighbors = targetsCents.map(target => Math.max(0, ...upperCents.map(pitch => {
    const distance = Math.abs(target - pitch);
    return Math.max(0, Math.min((distance - 35) / 65, (160 - distance) / 60));
  })));
  return neighbors.reduce((sum, value) => sum + value, 0) / neighbors.length;
}

export function weightedLyricalNeighborPenalty(upperCents: readonly number[], anchors: readonly MelodyAnchor[]): number {
  const valid = anchors.filter(anchor => Number.isFinite(anchor.cents) && Number.isFinite(anchor.weight) && anchor.weight > 0);
  const weight = valid.reduce((sum, anchor) => sum + anchor.weight, 0);
  return weight ? valid.reduce((sum, anchor) => sum + anchor.weight * lyricalNeighborPenalty(upperCents, [anchor.cents]), 0) / weight : 0;
}

/** Small nearest-voice beam supplies fully eligible continuations immediately,
 * including an initial sonority or a new region containing foreign pitches.
 * Existing aesthetic scoring chooses between these; there is no progression
 * catalogue and no sequential random consumption. */
export function lyricalProposals(upper: readonly number[], bass: number, center: number, tuning: TuningId,
  third: 3 | 4, ranges: readonly (readonly [number, number])[], bassRange: readonly [number, number]): { voices: number[]; bass: number }[] {
  const period = TUNINGS[tuning].divisions, field = lyricalField(tuning, third);
  const space = tuning === '12tet' ? undefined : nativeSpace(tuning);
  const minimumGap = space?.minimumGap ?? 2, maximumGap = space?.maximumGap ?? 14;
  let beam: { voices: number[]; cost: number }[] = [{ voices: [], cost: 0 }];
  for (let voice = 0; voice < 4; voice++) {
    const options: number[] = [];
    for (let pitch = ranges[voice][0]; pitch <= ranges[voice][1]; pitch++) if (field.includes(mod(pitch - center, period))) options.push(pitch);
    options.sort((a, b) => Math.abs(a - upper[voice]) - Math.abs(b - upper[voice]) || a - b);
    const next: typeof beam = [];
    for (const node of beam) for (const pitch of options.slice(0, 7)) {
      const previous = node.voices.at(-1), gap = previous === undefined ? 0 : pitch - previous;
      if (previous !== undefined && (gap < minimumGap || gap > maximumGap)) continue;
      const movement = Math.abs(pitch - upper[voice]) * 12 / period;
      const crowded = previous === undefined ? 0 : Math.max(0, 4 - gap * 12 / period) * .5;
      next.push({ voices: [...node.voices, pitch], cost: node.cost + movement + crowded });
    }
    next.sort((a, b) => a.cost - b.cost || (a.voices.join(',') < b.voices.join(',') ? -1 : a.voices.join(',') > b.voices.join(',') ? 1 : 0));
    beam = next.slice(0, 12);
  }
  const bassOptions: number[] = [];
  // Center, subdominant, dominant and relative sixth offer clear low anchors.
  // The voice/melody scores determine which one makes musical sense now.
  const anchors = [field[0], field[3], field[4], field[5]];
  for (const anchor of anchors) {
    const choices: number[] = [];
    for (let pitch = bassRange[0]; pitch <= bassRange[1]; pitch++) if (mod(pitch - center, period) === anchor) choices.push(pitch);
    choices.sort((a, b) => Math.abs(a - bass) - Math.abs(b - bass) || a - b);
    bassOptions.push(...choices.slice(0, 2));
  }
  const result: { voices: number[]; bass: number }[] = [];
  for (const node of beam) for (const lower of bassOptions) if (lower <= node.voices[0] - (space?.bassGap ?? 7)) result.push({ voices: node.voices, bass: lower });
  return result;
}
