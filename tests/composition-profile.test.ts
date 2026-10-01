import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveCompositionProfile } from '../src/composition-profile';
import { DEFAULT_PHRASING } from '../src/phrasing';
import { DEFAULT_PARAMETERS } from '../src/parameters';
import { DEFAULT_CONDUCTOR } from '../src/conductor';
import { DEFAULT_COMPOSITION } from '../src/composition';
import { MusicEngine } from '../src/engine';
import { ScoreTimeline } from '../src/engine/score-timeline';
import { createPerformance, parsePerformance, serializePerformance } from '../src/serialization';

test('one normalization boundary resolves every composition component and is idempotent', () => {
  for (const input of [{}, { phrasing: { ...DEFAULT_PHRASING, enabled: false } },
    { conductor: { ...DEFAULT_CONDUCTOR, enabled: false } }]) {
    const profile = resolveCompositionProfile(input);
    assert.equal(profile.conductor.enabled, true);
    assert.equal(profile.phrasing.enabled, true);
    assert.equal(profile.phrasing.character, 'lyrical');
    assert.ok(profile.phrasing.harmony && profile.phrasing.composition);
    assert.deepEqual(resolveCompositionProfile(profile), profile);
  }
  assert.equal(resolveCompositionProfile({ conductor: { ...DEFAULT_CONDUCTOR, enabled: false } }).conductor.amount, 0);
});

test('missing, disabled and exploratory phrase inputs all produce authored cores and realized harmonic routes', () => {
  for (const phrasing of [undefined, { ...DEFAULT_PHRASING, enabled: false }, { ...DEFAULT_PHRASING, character: 'exploratory' as const }]) {
    const engine = new MusicEngine({ seed: 'one-composition', parameters: DEFAULT_PARAMETERS, phrasing });
    for (let index = 0; index < 64; index++) {
      const frame = engine.step();
      assert.ok(frame.form && frame.phrase?.themeCore && frame.diagnostics.compositionExpression);
      assert.equal(frame.diagnostics.harmonicPlan?.realization.matched, true);
    }
  }
});

test('user automation is the final authority over shared expressive parameter trajectories', () => {
  const timeline = new ScoreTimeline({ seed: 'wide-story', parameters: DEFAULT_PARAMETERS,
    phrasing: { ...DEFAULT_PHRASING, composition: { ...DEFAULT_COMPOSITION, dynamicRange: 1 } },
    automation: [
      { parameter: 'dynamics', points: [{ tick: 0, value: .31 }] },
      { parameter: 'rhythmicDensity', points: [{ tick: 0, value: .12 }] },
      { parameter: 'tempo', points: [{ tick: 0, value: 83 }] },
    ] });
  for (let tick = 0; tick < 120000; tick += 960) {
    assert.equal(timeline.at(tick).parameters.dynamics, .31);
    assert.equal(timeline.at(tick).parameters.rhythmicDensity, .12);
    assert.equal(timeline.at(tick).parameters.tempo, 83);
  }
});

test('normalized performance JSON preserves the complete shared score and all note events', () => {
  const source = createPerformance('integrated-replay');
  source.sound = { ...source.sound, tuning: '19edo', instrument: 'additive' };
  source.conductor!.tuningTravel = false;
  const restored = parsePerformance(serializePerformance(source));
  const a = new MusicEngine({ ...source, parameters: source.initialParameters });
  const b = new MusicEngine({ ...restored, parameters: restored.initialParameters });
  for (let index = 0; index < 96; index++) assert.deepEqual(a.step(), b.step());
});

test('a caller cannot change the timeline by mutating its original configuration', () => {
  const config = { seed: 'owned-score', parameters: { ...DEFAULT_PARAMETERS }, sound: { ...createPerformance('owned-score').sound } };
  const a = new MusicEngine(config), b = new MusicEngine(structuredClone(config));
  config.seed = 'other-seed'; config.sound.tuning = '19edo'; config.parameters.dynamics = 0;
  for (let index = 0; index < 16; index++) assert.deepEqual(a.step(), b.step());
});
