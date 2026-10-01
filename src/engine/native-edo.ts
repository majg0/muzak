/** Bounded native EDO composition. Every integer here is a degree relative to A4;
 * the planner never rounds a generated 12-TET note onto a different tuning. */
import { TUNINGS } from '../pitch';
import { nativeClass, nativeSpace, validNativeVoices, type NativeTuningId } from './native-space';
import type { HarmonicTensionDiagnostics, Parameters, ScoreKey, ScoreWeights, TensionComponents } from '../types';
import { aggregateTension, bitCount, clamp, harmonicTensionDiagnostics, round, targetTension, triangle } from './analysis';
import { integer, random } from './random';
import type { RoughnessScorer } from './roughness-scoring';
import type { PlanningIntent } from './intent';
import { melodySupportNative } from './melody-support';
import { inLyricalField, lyricalField, lyricalNeighborPenalty, lyricalProposals, weightedLyricalNeighborPenalty } from './lyrical-support';
import { destinationProposals, harmonicRealization } from './harmonic-tools';

const FIELD_STRENGTHS = [1, .73, .86];
const collection = (degrees: number[], tuning: NativeTuningId): number => degrees.reduce((mask, n) => mask | (1 << nativeClass(n, tuning)), 0);

export interface NativeEdoState { upperDegrees: number[]; bassDegree: number; centerDegree: number; index: number; recent: number[]; }
export interface NativeEdoCandidate {
  state: NativeEdoState;
  scores: Record<ScoreKey, number>;
  total: number;
  distance: number;
  movementCents: number;
  dissonance: number;
  actual: number;
  target: number;
  tension: TensionComponents;
  harmonicTension?: HarmonicTensionDiagnostics;
  sensoryRoughness?: number;
  roughnessContribution?: number;
}

export function initialNativeState(seed: string, tuning: NativeTuningId): NativeEdoState {
  const period = TUNINGS[tuning].divisions;
  const centerDegree = integer(seed, 'native-initial', 0, period - 1, tuning, 'field');
  const shift = centerDegree <= period / 2 ? centerDegree : centerDegree - period;
  return { upperDegrees: [5500, 6200, 6700, 7400].map(c => Math.round((c - 6900) * period / 1200) + shift),
    bassDegree: Math.round((3600 - 6900) * period / 1200) + centerDegree, centerDegree, index: 0, recent: [] };
}

function fieldAttraction(degree: number, center: number, tuning: NativeTuningId): number {
  const mod = (n: number) => nativeClass(n, tuning);
  const { period, fourth, fifth } = nativeSpace(tuning), FIELD_DEGREES = [0, fourth, fifth];
  const relative = mod(degree - center);
  let best = 0;
  for (let i = 0; i < FIELD_DEGREES.length; i++) {
    const delta = Math.abs(relative - FIELD_DEGREES[i]);
    const distance = Math.min(delta, period - delta);
    best = Math.max(best, FIELD_STRENGTHS[i] * Math.max(0.08, 1 - distance * 19 / period * .18));
  }
  return best;
}

export function nativeFieldFit(upper: number[], bass: number, center: number, tuning: NativeTuningId): number {
  return round(upper.reduce((sum, degree) => sum + fieldAttraction(degree, center, tuning), 0) / 4 * 0.72 + fieldAttraction(bass, center, tuning) * 0.28);
}

/** An explicit spacing preference, not consonance or sensory roughness. Close
 * physical neighbors increase this tension regardless of octave/degree class. */
function spacingTension(upper: number[], bass: number, tuning: NativeTuningId): number {
  const period = TUNINGS[tuning].divisions;
  const degrees = [bass, ...upper];
  let sum = 0, weight = 0;
  for (let i = 0; i < degrees.length; i++) for (let j = i + 1; j < degrees.length; j++) {
    const spanCents = (degrees[j] - degrees[i]) * 1200 / period;
    const lowerPitchCents = 6900 + degrees[i] * 1200 / period;
    const w = 1 + clamp((6000 - lowerPitchCents) / 2400) * 0.3;
    sum += Math.max(0, 1 - spanCents / 700) * w;
    weight += w;
  }
  return round(clamp(sum / weight * 1.7));
}

function proposal(seed: string, state: NativeEdoState, p: Parameters, id: number, tuning: NativeTuningId): { upper: number[]; bass: number } | undefined {
  const mod = (n: number) => nativeClass(n, tuning);
  const { period, voices: ranges, bass: bassRange, step, fifth, fourth, bassGap } = nativeSpace(tuning);
  if (id === 0) return { upper: [...state.upperDegrees], bass: state.bassDegree };
  const address = [tuning, state.index, state.upperDegrees.join(','), state.bassDegree, id] as const;
  const first = integer(seed, 'native-voices', 0, 3, ...address, 'first');
  const direction = random(seed, 'native-voices', ...address, 'direction') < 0.5 ? -1 : 1;
  const active = id <= 3 ? 1 : id <= 6 ? 2 : 3;
  const maxStep = step(p.voiceLeading >= .72 ? 190 : p.voiceLeading >= .35 ? 315 : 505);
  const upper = state.upperDegrees.map((degree, voice) => {
    const order = (voice - first + 4) % 4;
    if (order >= active) return degree;
    const amount = random(seed, 'native-voices', ...address, voice, 'chromatic') < p.chromaticism * 0.7 ? 1 : integer(seed, 'native-voices', 1, maxStep, ...address, voice, 'step');
    const delta = amount * direction * (order % 2 === 0 ? 1 : -1);
    const candidate = degree + delta;
    return candidate < ranges[voice][0] || candidate > ranges[voice][1] ? degree - delta : candidate;
  });
  if (!validNativeVoices(upper, tuning)) return undefined;
  let bass = state.bassDegree;
  if (random(seed, 'native-bass', ...address, 'move') < 0.32 + p.bassMobility * 0.65) {
    if (random(seed, 'native-bass', ...address, 'independent') < p.bassIndependence) {
      const offsets = [-fifth, -fourth, -step(315), -step(190), -1, 1, step(190), step(315), fourth, fifth];
      const delta = offsets[integer(seed, 'native-bass', 0, offsets.length - 1, ...address, 'step')];
      bass += delta;
      if (bass < bassRange[0] || bass > bassRange[1]) bass = state.bassDegree - delta;
    } else {
      const degree = mod(upper[integer(seed, 'native-bass', 0, 3, ...address, 'anchor')] + (random(seed, 'native-bass', ...address, 'fifth') < 0.35 ? fifth : 0));
      const options: number[] = [];
      for (let n = bassRange[0]; n <= bassRange[1]; n++) if (mod(n) === degree) options.push(n);
      options.sort((a, b) => Math.abs(a - state.bassDegree) - Math.abs(b - state.bassDegree) || a - b);
      bass = options[0];
    }
  }
  if (bass > upper[0] - bassGap) bass -= period;
  if (bass < bassRange[0] || bass > bassRange[1]) return undefined;
  return { upper, bass };
}

function score(state: NativeEdoState, upper: number[], bass: number, center: number, p: Parameters, weights: ScoreWeights, sensory: RoughnessScorer, intent: PlanningIntent | undefined, tuning: NativeTuningId): NativeEdoCandidate {
  const mod = (n: number) => nativeClass(n, tuning);
  const { period, fourth, fifth } = nativeSpace(tuning);
  const deltas = upper.map((degree, i) => degree - state.upperDegrees[i]);
  const movement = deltas.reduce((sum, delta) => sum + Math.abs(delta), 0) * 12 / period;
  const before = collection([...state.upperDegrees, state.bassDegree], tuning), after = collection([...upper, bass], tuning);
  const collectionDistance = bitCount(before ^ after) / Math.max(1, bitCount(before | after));
  const bassChange = mod(bass - state.bassDegree);
  const bassColor = bassChange === 0 ? 0 : bassChange === fourth || bassChange === fifth ? 0.35 : bassChange === 1 || bassChange === period - 1 ? 1 : 0.7;
  const distance = round(collectionDistance * 0.72 + bassColor * 0.28);
  const harmonicDissonance = spacingTension(upper, bass, tuning);
  const target = intent?.targetTension ?? targetTension(state.index, p);
  const fit = nativeFieldFit(upper, bass, center, tuning);
  const meanDegree = upper.reduce((a, b) => a + b, 0) / 4;
  const tension: TensionComponents = {
    harmonic: harmonicDissonance, ambiguity: round(1 - fit),
    rhythmic: round(clamp(p.rhythmicComplexity * 0.55 + (1 - p.metricStability) * 0.3 + p.rhythmicDensity * 0.15)),
    register: round(clamp((meanDegree * 12 / period + 13) / 25)),
    density: round(p.texturalDensity * 0.7 + p.melodicActivity * 0.3),
    instability: round(clamp(movement / 18)),
    cadential: round(triangle(state.index, 8) * 0.65 + triangle(state.index, 32) * 0.35),
  };
  const actual = aggregateTension(tension);
  const harmonicTension = intent ? harmonicTensionDiagnostics(tension, p, target, tuning) : undefined;
  const common = deltas.filter(delta => delta === 0).length;
  const bassMotion = Math.abs(bass - state.bassDegree) * 12 / period;
  const repetition = state.recent.reduce((sum, mask, i) => sum + (mask === after ? 1 / (i + 1) : 0), 0);
  const contrary = deltas.some(delta => delta < 0) && deltas.some(delta => delta > 0);
  let fourths = 0;
  for (let i = 0; i < upper.length; i++) for (let j = i + 1; j < upper.length; j++) {
    const interval = mod(upper[j] - upper[i]);
    if (interval === fourth || interval === fifth) fourths++;
  }
  const raw: Record<ScoreKey, number> = {
    smoothness: -movement * (0.08 + p.voiceLeading * 0.19) - deltas.reduce((sum, d) => sum + Math.max(0, Math.abs(d) * 12 / period - 2) ** 2, 0) * (0.15 + p.voiceLeading * 0.85),
    commonTones: common * (0.04 + p.voiceLeading * 0.09),
    harmonicMotion: -Math.abs(distance - (0.06 + p.harmonicMobility * 0.72 + target * 0.07)) * (2 + p.harmonicMobility * 3.5) - Math.abs(bassMotion - p.bassMobility * 4.5) * 0.07,
    tonalGravity: (fit - 0.65) * (0.5 + p.tonalClarity * 7.5 + p.tonalGravity * 1.8),
    dissonance: -Math.abs(harmonicDissonance - clamp(0.035 + p.dissonance * 0.68 + target * 0.17, 0.04, 0.85)) * (3 + (1 - p.dissonance) * 3.5) - Math.max(0, harmonicDissonance - 0.72) * 5,
    tension: -Math.abs(actual - target) * 3.7,
    independence: (contrary ? 0.23 : 0) + (bassMotion > 2 && movement < 5 ? p.bassIndependence * 0.16 : 0),
    novelty: -repetition * (0.3 + p.harmonicSurprise * 1.5),
    structure: -Math.abs(meanDegree * 12 / period - (-8 + p.brightness * 10)) * 0.055 + fourths * p.quartalTendency * 0.15 + new Set(upper.slice(1).map((n, i) => mod(n - upper[i]))).size * p.intervalComplexity * 0.11,
  };
  if (harmonicTension) {
    const goal = harmonicTension.components;
    raw.tonalGravity = -Math.abs(tension.ambiguity - goal.ambiguity.target) * (1.5 + p.tonalClarity * 3 + p.tonalGravity * 1.5);
    raw.dissonance = -Math.abs(harmonicDissonance - goal.friction.target) * (3.5 + (1 - p.dissonance) * 2);
    raw.tension = -Math.abs(harmonicTension.actual - harmonicTension.target) * 7
      - Math.abs(tension.instability - goal.motion.target) * 1.5;
  }
  if (intent?.melodyTargetsCents?.length) raw.structure += (melodySupportNative(upper, bass, intent.melodyTargetsCents, tuning) - .55) * 2.5 * (intent.melodySupport ?? 1);
  if (intent?.lyrical) {
    const field = lyricalField(tuning, intent.homeThird), relative = mod(bass - center);
    const anchored = relative === field[0] || relative === field[3] || relative === field[4] ? 1 : relative === field[5] ? .7 : .2;
    // This native policy rewards an open, grounded physical arrangement; it
    // does not reinterpret the twelve-tone friction table as nineteen tones.
    raw.dissonance -= Math.max(0, harmonicDissonance - .18) * 8;
    const neighbor = intent.harmonicDestination && intent.melodyAnchors?.length
      ? weightedLyricalNeighborPenalty(upper.map(degree => 6900 + degree * 1200 / period), intent.melodyAnchors) * 3.8
      : lyricalNeighborPenalty(upper.map(degree => 6900 + degree * 1200 / period), intent.melodyTargetsCents ?? []) * 1.2;
    raw.structure += anchored * .8 - neighbor;
    if (intent.homeStrength) {
      const triad = new Set([field[0], field[2], field[4]]);
      const homeFit = upper.filter(degree => triad.has(mod(degree - center))).length / upper.length;
      const grounded = relative === 0 ? 1 : relative === field[4] ? .6 : 0;
      raw.structure += (homeFit * 2.8 + grounded * .75) * intent.homeStrength;
    }
  }
  if (intent?.harmonicDestination) {
    const match = harmonicRealization(intent.harmonicDestination, upper, bass, tuning);
    raw.structure += match.essentialToneFraction * 2 + (match.bassOnRoot ? 1 : 0);
  }
  const scores = Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, round(value * weights[key as ScoreKey])])) as Record<ScoreKey, number>;
  const sensoryResult = sensory.enabled ? sensory.evaluate([...upper, bass], state.index) : undefined;
  return { state: { upperDegrees: upper, bassDegree: bass, centerDegree: center, index: state.index + 1, recent: [after, ...state.recent].slice(0, 20) }, scores, total: round(Object.values(scores).reduce((a, b) => a + b, 0) + (sensoryResult?.contribution ?? 0)), distance, movementCents: round(movement * 100), dissonance: harmonicDissonance, actual, target, tension, ...(harmonicTension ? { harmonicTension } : {}), sensoryRoughness: sensoryResult?.value, roughnessContribution: sensoryResult?.contribution };
}

export function planNativeEdo(tuning: NativeTuningId, seed: string, state: NativeEdoState, parametersAt: (index: number) => Parameters, weights: ScoreWeights, sensory: RoughnessScorer, intentAt?: (index: number, p: Parameters) => PlanningIntent): { winner: NativeEdoCandidate; evaluated: number } {
  const mod = (n: number) => nativeClass(n, tuning);
  const { period, voices: ranges, bass: bassRange, step, fourth, fifth } = nativeSpace(tuning);
  let evaluated = 0;
  let beam: { state: NativeEdoState; first?: NativeEdoCandidate; utility: number; order: number }[] = [{ state, utility: 0, order: 0 }];
  for (let depth = 0; depth < 8; depth++) {
    const p = parametersAt(state.index + depth);
    const intent = intentAt?.(state.index + depth, p);
    const expanded: typeof beam = [];
    let order = 0;
    for (const node of beam) {
      let center = intent?.centerDegreeNative ?? node.state.centerDegree;
      if (intent?.centerDegreeNative === undefined && node.state.index > 0 && node.state.index % 8 === 0 && random(seed, 'native-field', tuning, node.state.index, 'migrate') < p.harmonicMobility * (0.92 - p.tonalClarity * 0.6)) {
        const shifts = [fifth, fourth, step(190), -step(190), 1, -1, step(315), -step(315)];
        center = mod(center + shifts[integer(seed, 'native-field', 0, p.harmonicSurprise > 0.65 ? 7 : 3, node.state.index, 'direction')]);
      }
      const seen = new Set<string>();
      const destination = intent?.harmonicDestination && !intent.holdHarmony
        ? destinationProposals(node.state.upperDegrees, node.state.bassDegree, intent.harmonicDestination, tuning, ranges, bassRange) : [];
      const lyrical = intent?.lyrical && !intent.holdHarmony && !intent.harmonicDestination
        ? lyricalProposals(node.state.upperDegrees, node.state.bassDegree, center, tuning, intent.homeThird ?? 4, ranges, bassRange) : [];
      const minimumDestinationLeap = destination.length ? Math.min(...destination.map(candidate => Math.max(...candidate.voices.map((pitch, voice) => Math.abs(pitch - node.state.upperDegrees[voice]))))) : 0;
      const destinationLeap = Math.max(step(p.voiceLeading >= .72 ? 315 : p.voiceLeading >= .35 ? 380 : 505), minimumDestinationLeap);
      for (let id = 0; id < (intent?.holdHarmony ? 1 : destination.length || 10 + lyrical.length); id++) {
        const candidateProposal = destination.length ? { upper: destination[id].voices, bass: destination[id].bass }
          : id >= 10 ? { upper: lyrical[id - 10].voices, bass: lyrical[id - 10].bass } : proposal(seed, node.state, p, id, tuning);
        if (!candidateProposal) continue;
        if (!validNativeVoices(candidateProposal.upper, tuning) || candidateProposal.bass < bassRange[0] || candidateProposal.bass > bassRange[1]) continue;
        if (intent?.lyrical && node.state.index > 0 && candidateProposal.upper.some((pitch, voice) => Math.abs(pitch - node.state.upperDegrees[voice]) > (destination.length ? destinationLeap : step(190)))) continue;
        if (intent?.lyrical && !intent.holdHarmony && !intent.harmonicDestination && !inLyricalField(candidateProposal.upper, candidateProposal.bass, center, tuning, intent.homeThird)) continue;
        const key = `${candidateProposal.upper.join(',')}/${candidateProposal.bass}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const candidate = score(node.state, candidateProposal.upper, candidateProposal.bass, center, p, weights, sensory, intent, tuning);
        evaluated++;
        expanded.push({ state: candidate.state, first: node.first ?? candidate, utility: round(node.utility + candidate.total * 0.92 ** depth), order: order++ });
      }
    }
    expanded.sort((a, b) => b.utility - a.utility || a.order - b.order);
    const seen = new Set<string>();
    beam = expanded.filter(node => {
      const key = `${node.state.upperDegrees.join(',')}/${node.state.bassDegree}`;
      if (seen.has(key)) return false;
      seen.add(key); return true;
    }).slice(0, 4);
  }
  return { winner: beam[0].first!, evaluated };
}
