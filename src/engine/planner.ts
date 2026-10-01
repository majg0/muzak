import type { HarmonicTensionDiagnostics, Parameters, ScoreWeights, ScoreKey, TensionComponents } from '../types';
import { aggregateTension, BASS_RANGE, clamp, dissonance, harmonicDistance, harmonicTensionDiagnostics, mod12, pitchClassMask, round, targetTension, tensionComponents, tonalFit, validVoices, voiceLeadingDistance, VOICE_RANGES } from './analysis';
import { integer, random } from './random';
import type { RoughnessScorer } from './roughness-scoring';
import type { PlanningIntent } from './intent';
import { melodySupport12 } from './melody-support';
import { inLyricalField, lyricalField, lyricalNeighborPenalty, lyricalProposals, weightedLyricalNeighborPenalty } from './lyrical-support';
import { destinationProposals, harmonicRealization } from './harmonic-tools';

export const PLANNING_HORIZON = 8;
const BEAM_WIDTH = 4;
const CANDIDATES = 13;

export interface HarmonicState {
  voices: number[];
  bass: number;
  center: number;
  index: number;
  recent: number[];
}

export interface Candidate {
  state: HarmonicState;
  scores: Record<ScoreKey, number>;
  total: number;
  distance: number;
  movement: number;
  intervallicFriction: number;
  actual: number;
  target: number;
  tension: TensionComponents;
  harmonicTension?: HarmonicTensionDiagnostics;
  sensoryRoughness?: number;
  roughnessContribution?: number;
}

function closestBass(pitchClass: number, around: number): number {
  let pitch = BASS_RANGE[0];
  let best = Infinity;
  for (let n = BASS_RANGE[0]; n <= BASS_RANGE[1]; n++) if (mod12(n) === mod12(pitchClass) && Math.abs(n - around) < best) {
    pitch = n; best = Math.abs(n - around);
  }
  return pitch;
}

function nextCenter(seed: string, state: HarmonicState, p: Parameters): number {
  if (state.index === 0 || state.index % 8 !== 0) return state.center;
  const likelihood = p.harmonicMobility * (0.92 - p.tonalClarity * 0.6);
  if (random(seed, 'gravity', state.index / 8, 'migrate') > likelihood) return state.center;
  const destinations = [7, 5, 2, -2, 1, -1, 3, -3];
  const limit = p.harmonicSurprise > 0.65 ? 8 : 4;
  return mod12(state.center + destinations[integer(seed, 'gravity', 0, limit - 1, state.index / 8, 'direction')]);
}

function proposal(seed: string, state: HarmonicState, p: Parameters, candidateId: number): { voices: number[]; bass: number } | undefined {
  if (candidateId === 0) return { voices: [...state.voices], bass: state.bass };
  const fingerprint = `${state.voices.join(',')}/${state.bass}`;
  const address = [state.index, fingerprint, candidateId] as const;
  const maxStep = p.voiceLeading >= 0.72 ? 2 : p.voiceLeading >= 0.35 ? 3 : 5;
  const activeCount = candidateId <= 4 ? 1 : candidateId <= 9 ? 2 : 3;
  const firstVoice = integer(seed, 'harmony', 0, 3, ...address, 'first');
  const direction = random(seed, 'harmony', ...address, 'direction') < 0.5 ? -1 : 1;
  const voices = state.voices.map((pitch, voice) => {
    const order = (voice - firstVoice + 4) % 4;
    if (order >= activeCount) return pitch;
    const moveDirection = order % 2 === 0 ? direction : -direction;
    let amount = integer(seed, 'harmony', 1, maxStep, ...address, voice, 'amount');
    // High chromaticism increases one-semitone opportunities; clarity nudges the
    // proposal pool toward the gravity field while scoring remains independent.
    if (random(seed, 'harmony', ...address, voice, 'chromatic') < p.chromaticism * 0.7) amount = 1;
    let value = pitch + moveDirection * amount;
    if (value < VOICE_RANGES[voice][0] || value > VOICE_RANGES[voice][1]) value = pitch - moveDirection * amount;
    return value;
  });
  if (!validVoices(voices)) return undefined;
  let bass = state.bass;
  const moves = random(seed, 'bass', ...address, 'moves') < 0.32 + p.bassMobility * 0.65;
  if (moves) {
    if (random(seed, 'bass', ...address, 'independent') < p.bassIndependence) {
      const offsets = [-7, -5, -3, -2, -1, 1, 2, 3, 5, 7];
      const offset = offsets[integer(seed, 'bass', 0, offsets.length - 1, ...address, 'offset')];
      bass = state.bass + offset;
      if (bass < BASS_RANGE[0] || bass > BASS_RANGE[1]) bass = state.bass - offset;
    } else {
      const anchor = voices[integer(seed, 'bass', 0, 3, ...address, 'anchor')];
      const fifth = random(seed, 'bass', ...address, 'fifth') < 0.35 ? 7 : 0;
      bass = closestBass(anchor + fifth, state.bass);
    }
  }
  // Low-end mud is a hard register constraint, distinct from aesthetic scoring.
  if (bass > voices[0] - 7) bass -= 12;
  if (bass < BASS_RANGE[0] || bass > BASS_RANGE[1]) return undefined;
  return { voices, bass };
}

export function scoreCandidate(state: HarmonicState, voices: number[], bass: number, p: Parameters, weights: ScoreWeights, center = state.center, sensory?: RoughnessScorer, intent?: PlanningIntent): Candidate {
  const movement = voiceLeadingDistance(state.voices, voices);
  const distance = harmonicDistance(state.voices, state.bass, voices, bass);
  const intervallicFriction = dissonance(voices, bass);
  const target = intent?.targetTension ?? targetTension(state.index, p);
  const tension = tensionComponents(voices, bass, state.voices, p, center, state.index, intent?.homeThird);
  const actual = aggregateTension(tension);
  const harmonicTension = intent ? harmonicTensionDiagnostics(tension, p, target) : undefined;
  const common = voices.filter((pitch, i) => pitch === state.voices[i]).length;
  const leapPenalty = voices.reduce((sum, pitch, i) => sum + Math.max(0, Math.abs(pitch - state.voices[i]) - 2) ** 2, 0);
  const desiredDistance = 0.06 + p.harmonicMobility * 0.72 + target * 0.07;
  const desiredDissonance = clamp(0.035 + p.dissonance * 0.68 + target * 0.17, 0.04, 0.85);
  const tonal = tonalFit(voices, bass, center, intent?.homeThird);
  const mask = pitchClassMask(voices, bass);
  const repetitions = state.recent.reduce((sum, prior, i) => sum + (prior === mask ? 1 / (i + 1) : 0), 0);
  const deltas = voices.map((pitch, i) => pitch - state.voices[i]);
  const contrary = deltas.some(d => d > 0) && deltas.some(d => d < 0);
  const allParallel = deltas.every(d => d > 0) || deltas.every(d => d < 0);
  const meanPitch = voices.reduce((a, b) => a + b, 0) / 4;
  const registerTarget = 61 + p.brightness * 10;
  const bassMovement = Math.abs(state.bass - bass);
  const desiredBassMovement = p.bassMobility * 4.5;
  let fourths = 0, thirds = 0;
  for (let i = 0; i < voices.length; i++) for (let j = i + 1; j < voices.length; j++) {
    const interval = mod12(voices[j] - voices[i]);
    if (interval === 5 || interval === 7) fourths++;
    if (interval === 3 || interval === 4 || interval === 8 || interval === 9) thirds++;
  }
  const uniqueIntervals = new Set(voices.slice(1).map((n, i) => mod12(n - voices[i]))).size;
  const raw: Record<ScoreKey, number> = {
    smoothness: -movement * (0.08 + p.voiceLeading * 0.19) - leapPenalty * (0.15 + p.voiceLeading * 0.85),
    commonTones: common * (0.04 + p.voiceLeading * 0.09),
    harmonicMotion: -Math.abs(distance - desiredDistance) * (2 + p.harmonicMobility * 3.5) - Math.abs(bassMovement - desiredBassMovement) * 0.07,
    tonalGravity: (tonal - 0.65) * (0.5 + p.tonalClarity * 7.5 + p.tonalGravity * 1.8),
    dissonance: -Math.abs(intervallicFriction - desiredDissonance) * (3 + (1 - p.dissonance) * 3.5) - Math.max(0, intervallicFriction - 0.72) * 5,
    tension: -Math.abs(actual - target) * 3.7,
    independence: (contrary ? 0.23 : 0) - (allParallel ? 0.24 : 0) + (bassMovement > 2 && movement < 5 ? p.bassIndependence * 0.16 : 0),
    novelty: -repetitions * (0.3 + p.harmonicSurprise * 1.5),
    structure: -Math.abs(meanPitch - registerTarget) * 0.055 + fourths * p.quartalTendency * 0.15 + thirds * (1 - p.quartalTendency) * 0.055 + uniqueIntervals * p.intervalComplexity * 0.11,
  };
  if (harmonicTension) {
    const goal = harmonicTension.components;
    // These penalties agree on the same destination. The old scalar objective
    // earned less for a tension rise than separate dissonance/tonality terms
    // charged for producing it, making its requested peaks unattainable.
    raw.tonalGravity = -Math.abs(tension.ambiguity - goal.ambiguity.target) * (1.5 + p.tonalClarity * 3 + p.tonalGravity * 1.5);
    raw.dissonance = -Math.abs(intervallicFriction - goal.friction.target) * (3.5 + (1 - p.dissonance) * 2)
      - Math.max(0, intervallicFriction - Math.max(.72, goal.friction.target + .16)) * 5;
    raw.tension = -Math.abs(harmonicTension.actual - harmonicTension.target) * 7
      - Math.abs(tension.instability - goal.motion.target) * 1.5;
  }
  if (intent?.homeRoot !== undefined && intent.homeStrength) {
    const landing = new Set([mod12(intent.homeRoot), mod12(intent.homeRoot + (intent.homeThird ?? 4)), mod12(intent.homeRoot + 7)]);
    const homeFit = voices.filter(pitch => landing.has(mod12(pitch))).length / 4;
    const groundedBass = mod12(bass - intent.homeRoot) === 0 ? 1 : mod12(bass - intent.homeRoot) === 7 ? 0.6 : 0;
    raw.structure += (homeFit * 2.8 + groundedBass * 0.75) * intent.homeStrength;
  }
  if (intent?.melodyTargetsCents?.length) {
    raw.structure += (melodySupport12(voices, bass, intent.melodyTargetsCents) - .55) * 3.2 * (intent.melodySupport ?? 1);
  }
  if (intent?.lyrical) {
    const field = lyricalField('12tet', intent.homeThird), root = intent.tonalCenter12 ?? center;
    const bassRelative = mod12(bass - root);
    const anchored = bassRelative === 0 || bassRelative === field[3] || bassRelative === field[4] ? 1 : bassRelative === field[5] ? .7 : .2;
    // Foreground tension can come from the melody and orchestral arc. A
    // held backing sonority should not chase a dense-cluster target at peaks.
    raw.dissonance -= Math.max(0, intervallicFriction - .22) * 12;
    const neighbor = intent.harmonicDestination && intent.melodyAnchors?.length
      ? weightedLyricalNeighborPenalty(voices.map(pitch => pitch * 100), intent.melodyAnchors) * 3.8
      : lyricalNeighborPenalty(voices.map(pitch => pitch * 100), intent.melodyTargetsCents ?? []) * 1.2;
    raw.structure += anchored * .8 - neighbor;
  }
  if (intent?.harmonicDestination) {
    const match = harmonicRealization(intent.harmonicDestination, voices, bass, '12tet');
    raw.structure += match.essentialToneFraction * 2 + (match.bassOnRoot ? 1 : 0);
  }
  const scores = Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, round(value * weights[key as ScoreKey])])) as Record<ScoreKey, number>;
  const sensoryResult = sensory?.enabled ? sensory.evaluate([...voices, bass], state.index) : undefined;
  return {
    state: { voices, bass, center, index: state.index + 1, recent: [mask, ...state.recent].slice(0, 20) },
    scores, total: round(Object.values(scores).reduce((a, b) => a + b, 0) + (sensoryResult?.contribution ?? 0)),
    distance, movement, intervallicFriction, actual, target, tension, ...(harmonicTension ? { harmonicTension } : {}),
    sensoryRoughness: sensoryResult?.value, roughnessContribution: sensoryResult?.contribution,
  };
}

/** Score future continuations, retain four paths, commit only the first event. */
export function plan(seed: string, state: HarmonicState, parametersAt: (index: number) => Parameters, weights: ScoreWeights, sensory?: RoughnessScorer, intentAt?: (index: number, p: Parameters) => PlanningIntent): { winner: Candidate; evaluated: number } {
  let evaluated = 0;
  let beam: { state: HarmonicState; first?: Candidate; utility: number; order: number }[] = [{ state, utility: 0, order: 0 }];
  for (let depth = 0; depth < PLANNING_HORIZON; depth++) {
    const expanded: typeof beam = [];
    const p = parametersAt(state.index + depth);
    const intent = intentAt?.(state.index + depth, p);
    let order = 0;
    for (const node of beam) {
      const center = intent?.tonalCenter12 ?? (intent?.homeRoot !== undefined && (intent.homeStrength ?? 0) > 0.4 ? intent.homeRoot : nextCenter(seed, node.state, p));
      const seen = new Set<string>();
      const ordinaryCount = CANDIDATES + (intent?.homeRoot === undefined ? 0 : 2);
      const destination = intent?.harmonicDestination && !intent.holdHarmony
        ? destinationProposals(node.state.voices, node.state.bass, intent.harmonicDestination, '12tet', VOICE_RANGES, BASS_RANGE) : [];
      const lyrical = intent?.lyrical && !intent.holdHarmony && !intent.harmonicDestination
        ? lyricalProposals(node.state.voices, node.state.bass, center, '12tet', intent.homeThird ?? 4, VOICE_RANGES, BASS_RANGE) : [];
      // A declared chord identity constrains the placement search. Its nearest
      // complete voicings may move every upper voice, unlike sparse local
      // perturbations. Smoothness still scores their physical motion.
      const minimumDestinationLeap = destination.length ? Math.min(...destination.map(candidate => Math.max(...candidate.voices.map((pitch, voice) => Math.abs(pitch - node.state.voices[voice]))))) : 0;
      const destinationLeap = Math.max(p.voiceLeading >= .72 ? 3 : p.voiceLeading >= .35 ? 4 : 5, minimumDestinationLeap);
      const count = intent?.holdHarmony ? 1 : destination.length || ordinaryCount + lyrical.length;
      for (let candidateId = 0; candidateId < count; candidateId++) {
        let proposalResult = destination.length ? destination[candidateId] : candidateId >= ordinaryCount ? lyrical[candidateId - ordinaryCount] : proposal(seed, node.state, p, candidateId);
        if (!destination.length && candidateId >= CANDIDATES && candidateId < ordinaryCount && intent?.homeRoot !== undefined) {
          const landing = new Set([mod12(intent.homeRoot), mod12(intent.homeRoot + (intent.homeThird ?? 4)), mod12(intent.homeRoot + 7)]);
          const voices = node.state.voices.map((pitch, voice) => {
            const options: number[] = [];
            for (let target = VOICE_RANGES[voice][0]; target <= VOICE_RANGES[voice][1]; target++) if (landing.has(mod12(target))) options.push(target);
            options.sort((a, b) => Math.abs(a - pitch) - Math.abs(b - pitch) || a - b);
            const target = options[0];
            return pitch + clamp(target - pitch, -2, 2);
          });
          let bass = candidateId === CANDIDATES ? node.state.bass : closestBass(intent.homeRoot, node.state.bass);
          if (bass > voices[0] - 7) bass -= 12;
          proposalResult = validVoices(voices) && bass >= BASS_RANGE[0] && bass <= BASS_RANGE[1] ? { voices, bass } : undefined;
        }
        if (!proposalResult) continue;
        if (!validVoices(proposalResult.voices) || proposalResult.bass < BASS_RANGE[0] || proposalResult.bass > BASS_RANGE[1]) continue;
        if (intent?.lyrical && node.state.index > 0 && proposalResult.voices.some((pitch, voice) => Math.abs(pitch - node.state.voices[voice]) > (destination.length ? destinationLeap : 2))) continue;
        if (intent?.lyrical && !intent.holdHarmony && !intent.harmonicDestination && !inLyricalField(proposalResult.voices, proposalResult.bass, center, '12tet', intent.homeThird)) continue;
        const key = `${proposalResult.voices.join(',')}/${proposalResult.bass}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const candidate = scoreCandidate(node.state, proposalResult.voices, proposalResult.bass, p, weights, center, sensory, intent);
        evaluated++;
        // A distant destination can rescue an ordinary local event. Mild
        // discounting retains responsiveness to live parameter changes.
        expanded.push({ state: candidate.state, first: node.first ?? candidate, utility: Math.round((node.utility + candidate.total * 0.92 ** depth) * 1000000) / 1000000, order: order++ });
      }
    }
    expanded.sort((a, b) => b.utility - a.utility || a.order - b.order);
    // Avoid spending the entire beam on copies of the same destination.
    const destinations = new Set<string>();
    beam = expanded.filter(node => {
      const key = `${node.state.voices.join(',')}/${node.state.bass}`;
      if (destinations.has(key)) return false;
      destinations.add(key);
      return true;
    }).slice(0, BEAM_WIDTH);
  }
  return { winner: beam[0].first!, evaluated };
}
