import { writeFileSync } from 'node:fs';
import { initialNativeState, planNativeEdo } from '../src/engine/native-edo';
import { nativeClass, nativeSpace, validNativeVoices, type NativeTuningId } from '../src/engine/native-space';
import { createRoughnessScorer } from '../src/engine/roughness-scoring';
import { harmonicPitchClasses, harmonicRealization, type HarmonicDestination, type HarmonicQuality } from '../src/engine/harmonic-tools';
import { DEFAULT_PARAMETERS, DEFAULT_WEIGHTS } from '../src/parameters';
import { degreeToPitch } from '../src/pitch';
import { DEFAULT_SOUND } from '../src/spectrum';
import { ENGINE_VERSION, FRAME_TICKS } from '../src/types';
import type { PlanningIntent } from '../src/engine/intent';

const parameters = { ...DEFAULT_PARAMETERS, voiceLeading: 1, harmonicMobility: .95, tonalClarity: .3, bassMobility: 1, bassIndependence: 1 };
const round = (value: number) => Math.round(value * 1000) / 1000;
const summary = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return { mean: round(values.reduce((a, b) => a + b, 0) / values.length), p95: round(sorted[Math.floor(sorted.length * .95)]), max: round(sorted.at(-1)!) };
};
const results = [];
for (const tuning of ['19edo', '24edo', '31edo'] as const) for (const semantic of [false, true]) for (const weight of [0, 3]) {
  const seed = `native-boundary-${tuning}`, space = nativeSpace(tuning);
  const sensory = createRoughnessScorer({ ...DEFAULT_SOUND, tuning, instrument: 'additive', roughnessWeight: weight }, degree => degreeToPitch(tuning, degree));
  let state = initialNativeState(seed, tuning), maximumMotionCents = 0, matched = 0;
  const costs: number[] = [], counts: number[] = [];
  const destinationAt = (index: number): HarmonicDestination => {
    const ordinal = Math.floor(index / 4), root = nativeClass(ordinal * space.fifth, tuning);
    const quality: HarmonicQuality = (['major', 'minor', 'dominant', 'suspended'] as const)[ordinal % 4];
    return { id: `${tuning}-${ordinal}`, root, region: root, quality, pitchClasses: harmonicPitchClasses(root, quality, tuning),
      startTick: ordinal * 4 * FRAME_TICKS, endTick: (ordinal + 1) * 4 * FRAME_TICKS,
      function: 'color', operation: 'native audit destination', cadence: null, strategy: 'balanced', melodyFit: 1 };
  };
  const intentAt = semantic ? (index: number): PlanningIntent => ({ targetTension: .5, lyrical: true, centerDegreeNative: 0,
    holdHarmony: index % 4 !== 0, harmonicDestination: destinationAt(index) }) : undefined;
  for (let frame = 0; frame < 64; frame++) {
    const begin = performance.now(), result = planNativeEdo(tuning, seed, state, () => parameters, DEFAULT_WEIGHTS, sensory, intentAt);
    const elapsed = performance.now() - begin;
    if (frame >= 8) costs.push(elapsed);
    counts.push(result.evaluated);
    const candidate = result.winner.state;
    if (!validNativeVoices(candidate.upperDegrees, tuning) || candidate.bassDegree < space.bass[0]
      || candidate.bassDegree > space.bass[1] || candidate.upperDegrees[0] - candidate.bassDegree < space.bassGap) throw new Error(`${tuning}: invalid committed state`);
    if (frame > 0) maximumMotionCents = Math.max(maximumMotionCents, ...candidate.upperDegrees.map((pitch, voice) => Math.abs(pitch - state.upperDegrees[voice]) * 1200 / space.period));
    if (semantic && harmonicRealization(destinationAt(frame), candidate.upperDegrees, candidate.bassDegree, tuning).matched) matched++;
    state = candidate;
  }
  results.push({ tuning, search: semantic ? 'semantic destinations with structural holds' : 'free continuation', roughnessWeight: weight,
    committedFrames: 64, warmupFrames: 8, milliseconds: summary(costs), evaluatedCandidates: summary(counts),
    maximumUpperMotionCents: round(maximumMotionCents), allConstraintsPassed: true,
    ...(semantic ? { matchedDestinations: matched } : {}) });
}
const report = { engineVersion: ENGINE_VERSION, searchHorizon: 8, beamWidth: 4,
  scheduler: { lookAheadMilliseconds: 400, shortestFrameMillisecondsAt180Bpm: 2 * 60_000 / 180 },
  scope: 'Standalone candidate planning on this Node runtime; excludes phrase planning, synthesis, browser load and garbage-collection contention.', results };
writeFileSync(new URL('../native-planner-audit.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
