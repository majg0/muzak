import test from 'node:test';
import assert from 'node:assert/strict';
import { harmonicTensionDiagnostics, aggregateTension, tensionComponents } from '../src/engine/analysis';
import { plan, scoreCandidate, type HarmonicState } from '../src/engine/planner';
import { initialEdo19State, planEdo19 } from '../src/engine/edo19';
import { DEFAULT_PARAMETERS, DEFAULT_WEIGHTS } from '../src/parameters';
import { createRoughnessScorer } from '../src/engine/roughness-scoring';
import { DEFAULT_SOUND } from '../src/spectrum';
import { degreeToPitch } from '../src/pitch';
import type { Parameters } from '../src/types';

const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
const state: HarmonicState = { voices: [55, 60, 64, 69], bass: 36, center: 0, index: 0, recent: [] };

test('harmonic actual is measured from candidate pitches and never follows a requested curve or orchestration control', () => {
  const components = tensionComponents(state.voices, state.bass, state.voices, DEFAULT_PARAMETERS, 0, 0);
  const low = harmonicTensionDiagnostics(components, DEFAULT_PARAMETERS, .05);
  const high = harmonicTensionDiagnostics(components, { ...DEFAULT_PARAMETERS, tension: 1, dynamics: 1, rhythmicDensity: 1, texturalDensity: 1 }, .95);
  assert.equal(low.actual, high.actual);
  assert.notEqual(low.target, high.target);
  const unrelated = { ...components, rhythmic: 1, density: 1, cadential: 1, register: 1 };
  assert.equal(harmonicTensionDiagnostics(unrelated, DEFAULT_PARAMETERS, .05).actual, low.actual);
  assert.notEqual(aggregateTension(unrelated), aggregateTension(components), 'The retained legacy total has different semantics.');
  const altered = harmonicTensionDiagnostics({ ...components, harmonic: .9 }, DEFAULT_PARAMETERS, .05);
  assert.ok(altered.actual > low.actual + .35);
});

test('a high energy request permits clear consonant harmony or a frictional excursion according to its independent controls', () => {
  const components = tensionComponents(state.voices, state.bass, state.voices, DEFAULT_PARAMETERS, 0, 0);
  const clear = harmonicTensionDiagnostics(components, { ...DEFAULT_PARAMETERS, dissonance: 0, tonalClarity: 1, tonalGravity: 1, voiceLeading: 1 }, 1);
  const exploratory = harmonicTensionDiagnostics(components, { ...DEFAULT_PARAMETERS, dissonance: .9, tonalClarity: .15, tonalGravity: .2, voiceLeading: .5 }, 1);
  assert.ok(clear.components.friction.target < .25);
  assert.ok(clear.components.ambiguity.target < .04);
  assert.ok(exploratory.target > clear.target + .4);
  assert.equal(clear.actual, exploratory.actual);
  const native = harmonicTensionDiagnostics(components, DEFAULT_PARAMETERS, 1, '19edo');
  assert.ok(native.components.friction.target < .25, 'Native physical crowding is not a12TET consonance table.');
});

test('legacy candidate diagnostics remain unchanged while autonomous scoring exposes its compatible harmonic goal', () => {
  const previous = scoreCandidate(state, state.voices, state.bass, DEFAULT_PARAMETERS, DEFAULT_WEIGHTS);
  const automatic = scoreCandidate(state, state.voices, state.bass, DEFAULT_PARAMETERS, DEFAULT_WEIGHTS, 0, undefined, { targetTension: previous.target });
  assert.equal(previous.harmonicTension, undefined);
  assert.equal(automatic.actual, previous.actual);
  assert.equal(automatic.target, previous.target);
  assert.deepEqual(automatic.tension, previous.tension);
  assert.ok(automatic.harmonicTension);
  assert.notDeepEqual(automatic.scores, previous.scores);
});

test('native planners track attainable component goals and materially distinguish calm and high-friction requests', () => {
  const cases: Array<{ drive: number; parameters: Parameters }> = [
    { drive: .12, parameters: { ...DEFAULT_PARAMETERS, dissonance: .035, tonalClarity: .92, tonalGravity: .9, voiceLeading: .97, harmonicMobility: .35 } },
    { drive: .88, parameters: { ...DEFAULT_PARAMETERS, dissonance: .72, tonalClarity: .35, tonalGravity: .4, voiceLeading: .85, harmonicMobility: .75 } },
  ];
  const means: number[] = [];
  for (const tuning of ['12tet', '19edo'] as const) for (const { drive, parameters } of cases) {
    let twelve = structuredClone(state), nineteen = initialEdo19State('harmonic-target');
    const scorer = createRoughnessScorer(DEFAULT_SOUND, degree => degreeToPitch('19edo', degree));
    const actuals: number[] = [], errors: number[] = [];
    for (let index = 0; index < 64; index++) {
      const winner = tuning === '12tet'
        ? plan('harmonic-target', twelve, () => parameters, DEFAULT_WEIGHTS, undefined, () => ({ targetTension: drive })).winner
        : planEdo19('harmonic-target', nineteen, () => parameters, DEFAULT_WEIGHTS, scorer, () => ({ targetTension: drive })).winner;
      if ('voices' in winner.state) twelve = winner.state; else nineteen = winner.state;
      if (index >= 8) {
        actuals.push(winner.harmonicTension!.actual);
        errors.push(Math.abs(winner.harmonicTension!.actual - winner.harmonicTension!.target));
      }
    }
    assert.ok(mean(errors) < .085, `${tuning} drive${drive} mean error${mean(errors)}`);
    means.push(mean(actuals));
  }
  assert.ok(means[1] > means[0] + .3, `12TET high request must change actual harmony: ${means}`);
  assert.ok(means[3] > means[2] + .08, `19EDO request must change physical spacing and attraction: ${means}`);
});
