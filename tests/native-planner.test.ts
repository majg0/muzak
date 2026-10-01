import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PARAMETERS, DEFAULT_WEIGHTS } from '../src/parameters';
import { DEFAULT_SOUND } from '../src/spectrum';
import { degreeToPitch, midiToPitch, type Pitch, type TuningId } from '../src/pitch';
import { initialNativeState, planNativeEdo } from '../src/engine/native-edo';
import { nativeClass, nativeSpace, validNativeVoices, type NativeTuningId } from '../src/engine/native-space';
import { createRoughnessScorer, type RoughnessScorer } from '../src/engine/roughness-scoring';
import { destinationProposals, harmonicPitchClasses, harmonicRealization, type HarmonicDestination } from '../src/engine/harmonic-tools';
import { absoluteFromNative, projectSonority } from '../src/engine/tuning-transition';
import { BASS_RANGE, validVoices } from '../src/engine/analysis';
import { FRAME_TICKS } from '../src/types';

const grids = ['19edo', '24edo', '31edo'] as const;
const parameters = { ...DEFAULT_PARAMETERS, voiceLeading: 1, harmonicMobility: 1, tonalClarity: .2, bassMobility: 1, bassIndependence: 1 };
const sensory = (tuning: NativeTuningId, weight = 0) => createRoughnessScorer({ ...DEFAULT_SOUND, tuning,
  instrument: 'additive', roughnessWeight: weight }, degree => degreeToPitch(tuning, degree));
function validState(state: ReturnType<typeof initialNativeState>, tuning: NativeTuningId) {
  const space = nativeSpace(tuning);
  assert.ok(validNativeVoices(state.upperDegrees, tuning));
  assert.ok(state.bassDegree >= space.bass[0] && state.bassDegree <= space.bass[1]);
  assert.ok(state.upperDegrees[0] - state.bassDegree >= space.bassGap);
}

test('native smooth continuation keeps hard physical movement limits with roughness off and on', () => {
  for (const tuning of grids) for (const weight of [0, 3]) for (const seed of ['native-edge', 'amber-river', '微分音']) {
    const space = nativeSpace(tuning), scorer = sensory(tuning, weight);
    let state = initialNativeState(seed, tuning);
    validState(state, tuning);
    for (let frame = 0; frame < 24; frame++) {
      const before = structuredClone(state), result = planNativeEdo(tuning, seed, state, () => parameters, DEFAULT_WEIGHTS, scorer);
      assert.deepEqual(state, before, 'Lookahead must not mutate its committed input.');
      assert.ok(result.evaluated >= 8 && result.evaluated <= 10 + 7 * 4 * 10);
      validState(result.winner.state, tuning);
      assert.equal(result.winner.state.index, state.index + 1);
      assert.ok(Number.isFinite(result.winner.total));
      for (const [voice, pitch] of result.winner.state.upperDegrees.entries()) {
        const movement = Math.abs(pitch - state.upperDegrees[voice]);
        assert.ok(movement <= space.step(190));
        assert.ok(movement * 1200 / space.period <= 200);
      }
      state = result.winner.state;
    }
  }
});

test('all native roots remain reachable through exact destinations and structural holds without empty beams', () => {
  for (const tuning of grids) {
    const seed = 'native-root-coverage', space = nativeSpace(tuning), scorer = sensory(tuning, 3);
    const destinationAt = (index: number): HarmonicDestination => {
      const ordinal = Math.floor(index / 2), root = nativeClass(ordinal, tuning);
      const quality = (['major', 'minor', 'dominant', 'diminished', 'suspended'] as const)[ordinal % 5];
      return { id: `${tuning}-${ordinal}`, root, region: root, quality, pitchClasses: harmonicPitchClasses(root, quality, tuning),
        startTick: ordinal * FRAME_TICKS * 2, endTick: (ordinal + 1) * FRAME_TICKS * 2,
        function: 'color', operation: 'native root test', cadence: null, strategy: 'balanced', melodyFit: 1 };
    };
    let state = initialNativeState(seed, tuning);
    const roots = new Set<number>();
    for (let frame = 0; frame < space.period * 2; frame++) {
      const destination = destinationAt(frame), before = state;
      const candidates = destinationProposals(state.upperDegrees, state.bassDegree, destination, tuning, space.voices, space.bass);
      assert.ok(candidates.length > 0, `${tuning} root ${destination.root} has no eligible voicing.`);
      const minimumFeasibleLeap = Math.min(...candidates.map(candidate => Math.max(...candidate.voices.map((pitch, voice) => Math.abs(pitch - state.upperDegrees[voice])))));
      const result = planNativeEdo(tuning, seed, state, () => parameters, DEFAULT_WEIGHTS, scorer,
        index => ({ targetTension: .5, lyrical: true, centerDegreeNative: 0, holdHarmony: index % 2 !== 0, harmonicDestination: destinationAt(index) }));
      state = result.winner.state;
      validState(state, tuning);
      assert.ok(harmonicRealization(destination, state.upperDegrees, state.bassDegree, tuning).matched);
      roots.add(nativeClass(state.bassDegree, tuning));
      if (frame % 2) {
        assert.deepEqual(state.upperDegrees, before.upperDegrees);
        assert.equal(state.bassDegree, before.bassDegree);
      } else if (frame > 0) for (const [voice, pitch] of state.upperDegrees.entries()) {
        assert.ok(Math.abs(pitch - before.upperDegrees[voice]) <= Math.max(space.step(315), minimumFeasibleLeap),
          'Smooth destinations may exceed the ordinary step only within the nearest feasible semantic placement limit.');
      }
    }
    assert.equal(roots.size, space.period);
  }
});

test('each native search samples all eight future parameter and sensory indices', () => {
  for (const tuning of grids) {
    const parameterIndices = new Set<number>(), sensoryIndices = new Set<number>();
    const scorer: RoughnessScorer = { applicable: true, enabled: true, evaluate: (_, index) => {
      sensoryIndices.add(index); return { value: .25, target: .25, contribution: 0 };
    } };
    const state = { ...initialNativeState('native-horizon', tuning), index: 41 };
    planNativeEdo(tuning, 'native-horizon', state, index => { parameterIndices.add(index); return parameters; }, DEFAULT_WEIGHTS, scorer);
    assert.deepEqual([...parameterIndices].sort((a, b) => a - b), [41, 42, 43, 44, 45, 46, 47, 48]);
    assert.deepEqual([...sensoryIndices].sort((a, b) => a - b), [41, 42, 43, 44, 45, 46, 47, 48]);
  }
});

test('boundary-register projections remain valid and idempotent for all sixteen supported tuning transfers', () => {
  const cases: { source: TuningId; upper: Pitch[]; bass: Pitch }[] = [
    { source: '12tet', upper: [48, 53, 58, 63].map(midiToPitch), bass: midiToPitch(28) },
    { source: '12tet', upper: [67, 72, 77, 84].map(midiToPitch), bass: midiToPitch(52) },
    { source: '12tet', upper: [58, 60, 62, 64].map(midiToPitch), bass: midiToPitch(51) },
  ];
  for (const source of grids) {
    const space = nativeSpace(source);
    for (let index = 0; index < 48; index++) {
      const state = initialNativeState(`projection-edge-${index}`, source);
      const shifts = [0, Math.max(...state.upperDegrees.map((pitch, voice) => space.voices[voice][0] - pitch)),
        Math.min(...state.upperDegrees.map((pitch, voice) => space.voices[voice][1] - pitch))];
      for (const shift of shifts) {
        const upper = state.upperDegrees.map(pitch => pitch + shift);
        const bass = Math.max(space.bass[0], Math.min(space.bass[1], state.bassDegree + shift, upper[0] - space.bassGap));
        validState({ ...state, upperDegrees: upper, bassDegree: bass }, source);
        cases.push({ source, upper: upper.map(degree => degreeToPitch(source, degree)), bass: degreeToPitch(source, bass) });
      }
    }
  }
  const pairs = new Set<string>();
  for (const source of cases) for (const target of ['12tet', ...grids] as const) {
    const projected = projectSonority(source.upper, source.bass, target);
    if (target === '12tet') {
      assert.ok(validVoices(projected.upper));
      assert.ok(projected.bass >= BASS_RANGE[0] && projected.bass <= BASS_RANGE[1]);
      assert.ok(projected.upper[0] - projected.bass >= 7);
    } else validState({ upperDegrees: projected.upper, bassDegree: projected.bass, centerDegree: 0, index: 0, recent: [] }, target);
    const upper = projected.upper.map(pitch => absoluteFromNative(pitch, target)), bass = absoluteFromNative(projected.bass, target);
    assert.deepEqual(projectSonority(upper, bass, target), projected);
    for (const [voice, pitch] of upper.entries()) assert.ok(Math.abs(pitch.millicents - source.upper[voice].millicents) <= 200_000);
    pairs.add(`${source.source}/${target}`);
  }
  assert.equal(pairs.size, 16);
});
