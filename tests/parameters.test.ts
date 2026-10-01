import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_PARAMETERS, DEFAULT_WEIGHTS, PARAMETER_DEFINITIONS, PRESETS, evaluateAutomation, interpolateParameters, normalizeParameters } from '../src/parameters';
import { addAutomationPoint, createPerformance, decodeShareState, encodeShareState, loadPresets, parsePerformance, recordLiveParameters, savePresets, scheduleParameterTransition, serializePerformance, upgradeParameterVector } from '../src/serialization';
import { MusicEngine } from '../src/engine/index';
import { DEFAULT_SOUND, type SoundConfig } from '../src/spectrum';
import { ENGINE_VERSION, FRAME_TICKS, type AutomationLane, type Frame } from '../src/types';

test('the 26 macro definitions and every preset stay in their declared ranges', () => {
  assert.equal(PARAMETER_DEFINITIONS.length, 26);
  assert.equal(new Set(PARAMETER_DEFINITIONS.map(def => def.key)).size, 26);
  for (const preset of PRESETS) assert.deepEqual(normalizeParameters(preset.parameters), preset.parameters);
  assert.equal(DEFAULT_PARAMETERS.rhythmicDensity, .15);
  assert.ok(Object.values(DEFAULT_WEIGHTS).every(weight => weight === 1));
});

test('v14 adds only its two new axes to a complete valid legacy vector', () => {
  const { ideaDensity, ensembleSize, ...old } = DEFAULT_PARAMETERS;
  assert.deepEqual(upgradeParameterVector(old), DEFAULT_PARAMETERS);
  assert.deepEqual(upgradeParameterVector(DEFAULT_PARAMETERS), DEFAULT_PARAMETERS);
  assert.throws(() => upgradeParameterVector({ ...old, tension: 2 }));
  assert.throws(() => upgradeParameterVector({ ...old, tempo: undefined }));
  assert.throws(() => upgradeParameterVector({ ...old, wrong: .5 }));
  const recipe = createPerformance('legacy-preserved');
  assert.throws(() => parsePerformance(JSON.stringify({ ...recipe, initialParameters: old })), /missing parameter/);
  const raw = JSON.stringify({ ...recipe, engineVersion: 'continuum-13.0.0', initialParameters: old });
  const source = JSON.parse(raw);
  const interpreted = parsePerformance(JSON.stringify({ ...source, engineVersion: ENGINE_VERSION, initialParameters: upgradeParameterVector(source.initialParameters) }));
  assert.equal(interpreted.initialParameters.ideaDensity, ideaDensity);
  assert.equal(interpreted.initialParameters.ensembleSize, ensembleSize);
  assert.equal(JSON.stringify(source), raw);
});

test('normalization clamps finite values and recovers missing or invalid inputs', () => {
  assert.equal(normalizeParameters({ tension: 4, tempo: -12 }).tension, 1);
  assert.equal(normalizeParameters({ tension: 4, tempo: -12 }).tempo, 40);
  assert.equal(normalizeParameters({ tension: NaN }).tension, DEFAULT_PARAMETERS.tension);
  assert.deepEqual(normalizeParameters(null), DEFAULT_PARAMETERS);
});

test('interpolation has exact endpoints, linear macros, and perceptual tempo', () => {
  const a = { ...DEFAULT_PARAMETERS, tension: 0, tempo: 40 };
  const b = { ...DEFAULT_PARAMETERS, tension: 1, tempo: 160 };
  assert.deepEqual(interpolateParameters(a, b, 0), a);
  assert.deepEqual(interpolateParameters(a, b, 1), b);
  assert.equal(interpolateParameters(a, b, .25).tension, .25);
  assert.ok(Math.abs(interpolateParameters(a, b, .5).tempo - 80) < 1e-10);
  assert.deepEqual(interpolateParameters(a, b, -1), a);
  assert.deepEqual(interpolateParameters(a, b, 2), b);
});

test('automation follows outgoing curves, holds outside lane, and keeps independent keys', () => {
  const lane: AutomationLane = { parameter: 'tension', points: [{ tick: 100, value: .2, curve: 'linear' }, { tick: 200, value: .8, curve: 'step' }, { tick: 300, value: .4 }] };
  assert.equal(evaluateAutomation(DEFAULT_PARAMETERS, [lane], 99).tension, DEFAULT_PARAMETERS.tension);
  assert.equal(evaluateAutomation(DEFAULT_PARAMETERS, [lane], 150).tension, .5);
  assert.equal(evaluateAutomation(DEFAULT_PARAMETERS, [lane], 299).tension, .8);
  assert.equal(evaluateAutomation(DEFAULT_PARAMETERS, [lane], 300).tension, .4);
  assert.equal(evaluateAutomation(DEFAULT_PARAMETERS, [lane], 10_000).tension, .4);
  assert.equal(evaluateAutomation(DEFAULT_PARAMETERS, [lane], 150).harmonicMobility, DEFAULT_PARAMETERS.harmonicMobility);
  const smooth: AutomationLane = { parameter: 'tension', points: [{ tick: 0, value: 0, curve: 'smooth' }, { tick: 100, value: 1 }] };
  assert.equal(evaluateAutomation(DEFAULT_PARAMETERS, [smooth], 25).tension, .15625);
  assert.equal(evaluateAutomation(DEFAULT_PARAMETERS, [smooth], 75).tension, .84375);
});

test('adding automation points is immutable, replaces existing ticks, and sorts points', () => {
  const original: AutomationLane[] = [{ parameter: 'tension', points: [{ tick: 200, value: .4, curve: 'step' }] }];
  const snapshot = JSON.stringify(original);
  let result = addAutomationPoint(original, 'tension', 100, .2);
  result = addAutomationPoint(result, 'tension', 200, .7, 'smooth');
  result = addAutomationPoint(result, 'tempo', 0, 100);
  assert.equal(JSON.stringify(original), snapshot);
  assert.deepEqual(result.find(lane => lane.parameter === 'tension')!.points, [{ tick: 100, value: .2, curve: 'linear' }, { tick: 200, value: .7, curve: 'smooth' }]);
  assert.equal(result.find(lane => lane.parameter === 'tempo')!.points[0].value, 100);
  assert.throws(() => addAutomationPoint(original, 'tempo', 0, 999));
  assert.throws(() => addAutomationPoint(original, 'tension', .5, .5));
});

test('performance JSON and URL state preserve Unicode seeds and full trajectories', () => {
  const performance = createPerformance('東京 · blå skymning 🎹');
  performance.automation = addAutomationPoint([], 'tension', 0, .3, 'smooth');
  performance.automation = addAutomationPoint(performance.automation, 'tension', 100_000, .8);
  performance.bookmarks.push({ id: 'moment-1', name: 'A beautiful turn', tick: 48_000 });
  assert.deepEqual(parsePerformance(serializePerformance(performance)), performance);
  const url = encodeShareState(performance);
  assert.match(url, /^#p=[A-Za-z0-9_-]+$/);
  assert.deepEqual(decodeShareState(url), performance);
  performance.initialParameters.tension = 0;
  assert.equal(PRESETS[0].parameters.tension, DEFAULT_PARAMETERS.tension);
});

test('sound configuration is explicit and preserves every spectrum value in JSON and links', () => {
  const performance = createPerformance('spectral-history');
  assert.deepEqual(performance.sound, DEFAULT_SOUND);
  assert.notEqual(performance.sound, DEFAULT_SOUND);
  assert.notEqual(performance.sound.spectrum.partials, DEFAULT_SOUND.spectrum.partials);
  const configured: SoundConfig = {
    tuning: '19edo', instrument: 'additive', roughnessWeight: 2.75, roughnessTarget: .314,
    spectrum: { id: 'custom-stretched', name: 'Stretched 五', partials: [{ ratio: 1, amplitude: 1 }, { ratio: 2.07, amplitude: .62 }, { ratio: 3.24, amplitude: .41 }, { ratio: 4.62, amplitude: .19 }, { ratio: 6.13, amplitude: .075 }] },
  };
  performance.sound = configured;
  assert.deepEqual(parsePerformance(serializePerformance(performance)).sound, configured);
  assert.deepEqual(decodeShareState(encodeShareState(performance))?.sound, configured);
  const edited = recordLiveParameters(performance, { tension: .4 }, FRAME_TICKS);
  assert.deepEqual(edited.sound, configured);
});

test('unsupported old engine versions and malformed sound configurations reject explicitly', () => {
  const performance = createPerformance('sound-validation');
  const invalid = (configuration: unknown) => assert.throws(() => parsePerformance(JSON.stringify({ ...performance, sound: configuration })));
  assert.notEqual(ENGINE_VERSION, 'continuum-1.0.0');
  assert.throws(() => parsePerformance(JSON.stringify({ ...performance, engineVersion: 'continuum-1.0.0' })), /unsupported engine version/);
  invalid(undefined);
  invalid({ ...DEFAULT_SOUND, tuning: '53edo' });
  invalid({ ...DEFAULT_SOUND, instrument: 'unknown' });
  invalid({ ...DEFAULT_SOUND, roughnessWeight: 3.1 });
  invalid({ ...DEFAULT_SOUND, roughnessTarget: -1 });
  invalid({ ...DEFAULT_SOUND, roughnessTarget: undefined });
  for (const field of ['ratio', 'amplitude'] as const) for (const badValue of [-1, NaN, Infinity]) {
    const partials = DEFAULT_SOUND.spectrum.partials.map(partial => ({ ...partial }));
    partials[2][field] = badValue;
    invalid({ ...DEFAULT_SOUND, spectrum: { ...DEFAULT_SOUND.spectrum, partials } });
  }
  invalid({ ...DEFAULT_SOUND, spectrum: { ...DEFAULT_SOUND.spectrum, partials: DEFAULT_SOUND.spectrum.partials.slice(0, 4) } });
  invalid({ ...DEFAULT_SOUND, spectrum: { ...DEFAULT_SOUND.spectrum, partials: [...DEFAULT_SOUND.spectrum.partials, { ratio: 8, amplitude: .1 }] } });
  invalid({ ...DEFAULT_SOUND, spectrum: { ...DEFAULT_SOUND.spectrum, partials: DEFAULT_SOUND.spectrum.partials.map((partial, i) => i === 1 ? { ratio: 1, amplitude: .5 } : partial) } });
  invalid({ ...DEFAULT_SOUND, spectrum: { ...DEFAULT_SOUND.spectrum, partials: DEFAULT_SOUND.spectrum.partials.map((partial, i) => i === 4 ? { ratio: 17, amplitude: .5 } : partial) } });
  invalid({ ...DEFAULT_SOUND, spectrum: { ...DEFAULT_SOUND.spectrum, partials: DEFAULT_SOUND.spectrum.partials.map((partial, i) => i === 2 ? { ratio: partial.ratio, amplitude: 0 } : partial) } });
});

test('imports reject corruption, unsupported versions, impossible values, and ambiguous lanes', () => {
  const valid = createPerformance('test');
  const invalid = (patch: Record<string, unknown>) => assert.throws(() => parsePerformance(JSON.stringify({ ...valid, ...patch })));
  invalid({ engineVersion: 'continuum-future' });
  invalid({ seed: '' });
  invalid({ initialParameters: { ...valid.initialParameters, tension: 2 } });
  invalid({ initialParameters: { ...valid.initialParameters, surpriseTypo: 1 } });
  invalid({ weights: { smoothness: 1 } });
  invalid({ automation: [{ parameter: 'tension', points: [{ tick: 10, value: .1 }, { tick: 1, value: .2 }] }] });
  invalid({ automation: [{ parameter: 'tension', points: [{ tick: 1, value: .1 }, { tick: 1, value: .2 }] }] });
  invalid({ automation: [{ parameter: 'tension', points: [{ tick: 1, value: .1, curve: 'unknown' }] }] });
  invalid({ automation: [{ parameter: 'tension', points: [{ tick: 0, value: .1, curve: 'smooth', rampEnd: { tick: 40, value: .9 } }, { tick: 50, value: .5 }] }] });
  invalid({ automation: [{ parameter: 'tension', points: [{ tick: 0, value: .1, curve: 'step', rampEnd: { tick: 100, value: .9 } }, { tick: 50, value: .5 }] }] });
  invalid({ automation: [{ parameter: 'tension', points: [] }, { parameter: 'tension', points: [] }] });
  invalid({ bookmarks: [{ id: 'a', name: 'negative tick', tick: -1 }] });
  assert.throws(() => parsePerformance('{broken'));
  assert.throws(() => parsePerformance(' '.repeat(2_000_001)));
  for (const bad of ['', '#x=abc', '#p=%%%', '#p=abcd', '#p=wA']) assert.equal(decodeShareState(bad), null);
});

test('preset persistence survives corrupt storage and returns independent custom values', () => {
  const store = new Map<string, string>();
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => store.set(key, value) } });
  try {
    savePresets([{ ...PRESETS[0], id: 'my-preset' }]);
    const loaded = loadPresets();
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0].custom, true);
    assert.deepEqual(loaded[0].parameters, DEFAULT_PARAMETERS);
    store.set('continuum.presets.v1', '{broken');
    assert.deepEqual(loadPresets(), []);
  } finally {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});

test('live edits preserve every prior tick of linear, smooth, and step ramps exactly', () => {
  for (const curve of ['linear', 'smooth', 'step'] as const) {
    let original = createPerformance('history');
    original.automation = [{ parameter: 'tension', points: [{ tick: 0, value: .13, curve }, { tick: 1000, value: .91 }] }];
    for (const tick of [1, 333, 999, 1000, 1500]) {
      const snapshot = JSON.stringify(original);
      const edited = recordLiveParameters(original, { tension: .6, tempo: 112 }, tick);
      for (let prior = 0; prior < tick; prior++) assert.deepEqual(evaluateAutomation(edited.initialParameters, edited.automation, prior), evaluateAutomation(original.initialParameters, original.automation, prior), `${curve} at tick ${prior} changed after edit ${tick}`);
      assert.equal(evaluateAutomation(edited.initialParameters, edited.automation, tick).tension, .6);
      assert.equal(JSON.stringify(original), snapshot);
      assert.deepEqual(parsePerformance(serializePerformance(edited)), edited);
    }
  }
});

test('new transitions preserve smooth curve history when inserted or replacing an existing point', () => {
  const original = scheduleParameterTransition(createPerformance('timeline'), 'tension', 0, 1000, .95, 'smooth');
  for (const startTick of [333, 1000, 2000]) {
    const edited = scheduleParameterTransition(original, 'tension', startTick, startTick + 300, .1, 'linear', 200);
    for (let tick = 0; tick <= startTick; tick++) assert.equal(evaluateAutomation(edited.initialParameters, edited.automation, tick).tension, evaluateAutomation(original.initialParameters, original.automation, tick).tension);
    assert.equal(evaluateAutomation(edited.initialParameters, edited.automation, startTick + 300).tension, .1);
    assert.deepEqual(edited.automationRevisions?.map(revision => revision.tick), [0, 200]);
  }
  assert.throws(() => scheduleParameterTransition(original, 'tension', 100, 300, .4, 'linear', 200));
});

test('revisions coalesce repeated live edits while retaining original planner knowledge', () => {
  const original = scheduleParameterTransition(createPerformance('knowledge'), 'tension', 0, 1000, .8, 'smooth');
  let edited = recordLiveParameters(original, { tension: .3 }, 300);
  edited = recordLiveParameters(edited, { tension: .5, dissonance: .4 }, 300);
  assert.deepEqual(edited.automationRevisions?.map(revision => revision.tick), [0, 300]);
  assert.deepEqual(edited.automationRevisions?.[0].lanes, original.automation);
  edited = recordLiveParameters(edited, { tempo: 90 }, 500);
  const forked = recordLiveParameters(edited, { brightness: .9 }, 400);
  assert.deepEqual(forked.automationRevisions?.map(revision => revision.tick), [0, 300, 400]);
  assert.deepEqual(parsePerformance(serializePerformance(forked)), forked);
  assert.deepEqual(decodeShareState(encodeShareState(forked)), forked);
  assert.throws(() => parsePerformance(JSON.stringify({ ...edited, automationRevisions: [{ tick: 1, lanes: edited.automation }] })));
  assert.throws(() => parsePerformance(JSON.stringify({ ...edited, automationRevisions: [{ tick: 0, lanes: [] }] })));
});

test('live performances in both tunings with interrupted ramps and future edits replay complete frames exactly', () => {
  for (const sound of [DEFAULT_SOUND, { ...DEFAULT_SOUND, tuning: '19edo' as const, instrument: 'additive' as const, roughnessWeight: 1 }]) {
    let performance = scheduleParameterTransition(createPerformance('live-ramp-replay'), 'tension', 0, FRAME_TICKS * 30, .88, 'smooth');
    performance.sound = structuredClone(sound);
    const live = new MusicEngine({ seed: performance.seed, parameters: performance.initialParameters, automation: performance.automation, weights: performance.weights, sound: performance.sound });
    const played: Frame[] = [];
    for (let i = 0; i < 6; i++) played.push(live.step());
    performance = recordLiveParameters(performance, { tension: .24, harmonicMobility: .94 }, live.tick);
    live.setAutomation(performance.automation, performance.automationRevisions);
    for (let i = 0; i < 4; i++) played.push(live.step());
    performance = scheduleParameterTransition(performance, 'tonalClarity', live.tick + FRAME_TICKS * 2, live.tick + FRAME_TICKS * 10, .12, 'smooth', live.tick);
    live.setAutomation(performance.automation, performance.automationRevisions);
    for (let i = 0; i < 16; i++) played.push(live.step());
    const restored = parsePerformance(serializePerformance(performance));
    const replay = new MusicEngine({ seed: restored.seed, parameters: restored.initialParameters, automation: restored.automation, automationRevisions: restored.automationRevisions, weights: restored.weights, sound: restored.sound });
    assert.deepEqual(Array.from({ length: played.length }, () => replay.step()), played, `Live replay diverged in ${sound.tuning}`);
  }
});
