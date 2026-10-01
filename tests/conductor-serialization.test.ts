import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONDUCTOR, MANUAL_CONDUCTOR, conductParameters, formAt, rhythmicHomeFor, themeIds } from '../src/conductor';
import { createPerformance, serializePerformance, parsePerformance, encodeShareState, decodeShareState, scheduleParameterTransition, recordLiveParameters } from '../src/serialization';
import { MusicEngine } from '../src/engine';
import { FRAME_TICKS, type Frame, type Performance } from '../src/types';

test('new and older recipe shapes resolve a mandatory composition; disabled freedom stays neutral', () => {
  const performance = createPerformance('new-form');
  assert.deepEqual(performance.conductor, DEFAULT_CONDUCTOR);
  const { conductor, ...manual } = performance;
  assert.deepEqual(parsePerformance(JSON.stringify(manual)).conductor, { ...MANUAL_CONDUCTOR, enabled: true });
  assert.deepEqual(parsePerformance(serializePerformance(performance)), performance);
});

test('form pace, autonomy and tuning travel survive exact JSON and URL sharing', () => {
  const performance = createPerformance('a returning theme ♫');
  performance.conductor = { enabled: true, amount: .97, pace: .82, tuningTravel: false };
  assert.deepEqual(decodeShareState(encodeShareState(performance)), performance);
  for (const patch of [{ amount: 2 }, { pace: -.01 }, { enabled: 'yes' }, { tuningTravel: 1 }, { amount: null }]) {
    assert.throws(() => parsePerformance(JSON.stringify({ ...performance, conductor: { ...performance.conductor, ...patch } })));
  }
});

test('a manual transition begins from the actual conducted macro value', () => {
  const performance = createPerformance('transition-in-form');
  const start = 960 * 15;
  const expected = conductParameters(performance.seed, start, performance.initialParameters, performance.conductor!, performance.sound.tuning).tempo;
  const edited = scheduleParameterTransition(performance, 'tempo', start, start + 960 * 4, 120, 'smooth');
  assert.equal(edited.automation[0].points[0].value, expected);
});

test('an autonomous journey with live overrides replays exactly through meter and tuning returns', () => {
  let performance = createPerformance('autonomous-recording');
  performance.conductor = { ...DEFAULT_CONDUCTOR, pace: 1 };
  const makeEngine = (recipe: Performance) => new MusicEngine({
    seed: recipe.seed, parameters: recipe.initialParameters, automation: recipe.automation,
    automationRevisions: recipe.automationRevisions, weights: recipe.weights, sound: recipe.sound, conductor: recipe.conductor,
  });
  const live = makeEngine(performance), heard: Frame[] = [];
  for (let i = 0; i < 5; i++) heard.push(live.step());
  const editTick = live.tick;
  performance = recordLiveParameters(performance, { tension: .12, melodicActivity: .91 }, editTick);
  live.setAutomation(performance.automation, performance.automationRevisions);
  for (let i = 0; i < 7; i++) heard.push(live.step());
  const rampStart = live.tick + FRAME_TICKS * 2, rampEnd = rampStart + FRAME_TICKS * 6;
  performance = scheduleParameterTransition(performance, 'tempo', rampStart, rampEnd, 110, 'smooth', live.tick);
  live.setAutomation(performance.automation, performance.automationRevisions);
  while (formAt(performance.seed, live.tick, performance.conductor!).cycle < 1) heard.push(live.step());
  assert.ok(heard.some(frame => frame.form?.tuning === '19edo'), 'The fixture must cross a native tuning excursion.');
  assert.ok(heard.some(frame => frame.notes.some(note => note.endPitch)), 'Tuning transitions must carry pitch curves.');
  for (const frame of heard) {
    const form = frame.form!, source = themeIds(performance.seed).map(themeId => rhythmicHomeFor(performance.seed, themeId))
      .find(home => home.cell.id === form.meterSourceId)!;
    assert.ok(source, 'The performance carries actual source-derived meter metadata.');
    assert.deepEqual(form.meter, source.meter);
    assert.deepEqual(form.meterGroups, source.groups);
    assert.ok(form.meterResidenceStartTick! <= frame.tick);
  }
  assert.ok(heard.filter(frame => frame.tick >= editTick).every(frame => frame.parameters.tension === .12 && frame.parameters.melodicActivity === .91), 'Explicit lanes override the autonomous macros.');
  assert.ok(heard.filter(frame => frame.tick >= rampEnd).every(frame => frame.parameters.tempo === 110));
  const restored = parsePerformance(serializePerformance(performance));
  const replay = makeEngine(restored);
  assert.deepEqual(Array.from({ length: heard.length }, () => replay.step()), heard);
  assert.deepEqual(decodeShareState(encodeShareState(performance)), restored);
});
