import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONDUCTOR, formAt, rhythmicHomeFor, themeIds } from '../src/conductor';
import { DEFAULT_COMPOSITION } from '../src/composition';
import { MusicEngine } from '../src/engine';
import { DEFAULT_PHRASING, MANUAL_PHRASING, type PhraseConfig } from '../src/phrasing';
import { resolveCompositionProfile } from '../src/composition-profile';
import { degreeToPitch, pitchToDegree } from '../src/pitch';
import {
  createPerformance, decodeShareState, encodeShareState, parsePerformance,
  recordLiveParameters, scheduleParameterTransition, serializePerformance,
} from '../src/serialization';
import { FRAME_TICKS, type Frame, type Performance } from '../src/types';

const composer = (recipe: Performance) => new MusicEngine({
  seed: recipe.seed, parameters: recipe.initialParameters, sound: recipe.sound,
  conductor: recipe.conductor, phrasing: recipe.phrasing, weights: recipe.weights,
  automation: recipe.automation, automationRevisions: recipe.automationRevisions,
});

test('new and absent legacy phrase configurations enter the canonical composition profile', () => {
  const recipe = createPerformance('a phrase begins');
  assert.deepEqual(recipe.phrasing, resolveCompositionProfile({ phrasing: DEFAULT_PHRASING }).phrasing);
  recipe.phrasing!.space = .123;
  assert.equal(createPerformance('a separate phrase').phrasing!.space, DEFAULT_PHRASING.space);
  const { phrasing: _omitted, ...withoutPhrasing } = recipe;
  const restored = parsePerformance(JSON.stringify(withoutPhrasing));
  assert.deepEqual(restored.phrasing, resolveCompositionProfile({ phrasing: MANUAL_PHRASING }).phrasing);
  assert.deepEqual(decodeShareState(encodeShareState(withoutPhrasing))!.phrasing, restored.phrasing);
  assert.deepEqual(parsePerformance(serializePerformance(restored)), restored);
});

test('every explicit phrasing control survives full performance JSON and Unicode share URLs', () => {
  const recipe = createPerformance('呼吸と対話 ♫');
  const phrasing: PhraseConfig = {
    enabled: true, space: .123456789, syncopation: .87654321, interplay: 0,
    virtuosity: 1, renewal: .42, variation: .735, distribution: 'adventurous', arc: 'waves',
    composition: { ...DEFAULT_COMPOSITION, development: .123456789, repetition: .84, embellishment: 0, cohesion: 1, accent: .36, dynamicRange: .91 },
  };
  recipe.phrasing = phrasing;
  recipe.bookmarks.push({ id: 'phrase-3', name: 'A returning idea', tick: 960 * 16 });
  const canonical = { ...recipe, ...resolveCompositionProfile(recipe) };
  assert.deepEqual(parsePerformance(serializePerformance(recipe)), canonical);
  assert.deepEqual(decodeShareState(encodeShareState(recipe)), canonical);
  const restored = parsePerformance(serializePerformance(recipe));
  restored.phrasing!.interplay = .9;
  assert.equal(phrasing.interplay, 0);
});

test('performance imports reject corrupt and incomplete phrase controls', () => {
  const recipe = createPerformance('strict-phrase-import');
  for (const phrasing of [null, [], 'enabled', {},
    { ...DEFAULT_PHRASING, space: '0.5' }, { ...DEFAULT_PHRASING, enabled: 1 },
    { ...DEFAULT_PHRASING, variation: -.001 }, { ...DEFAULT_PHRASING, virtuosity: 1.001 },
    { ...DEFAULT_PHRASING, distribution: 'anything' }, { ...DEFAULT_PHRASING, arc: 'exponential' },
    { ...DEFAULT_PHRASING, unknownControl: .3 }]) {
    assert.throws(() => parsePerformance(JSON.stringify({ ...recipe, phrasing })));
  }
  for (const key of Object.keys(DEFAULT_PHRASING).filter(key => key !== 'composition')) {
    const incomplete = { ...DEFAULT_PHRASING } as Partial<PhraseConfig>;
    delete incomplete[key as keyof PhraseConfig];
    assert.throws(() => parsePerformance(JSON.stringify({ ...recipe, phrasing: incomplete })));
  }
});

test('composition JSON and URL imports supply canonical defaults and reject malformed nested controls', () => {
  const recipe = createPerformance('nested-composition');
  assert.deepEqual(recipe.phrasing!.composition, DEFAULT_COMPOSITION);
  delete recipe.phrasing!.composition;
  const expected = { ...recipe, phrasing: { ...recipe.phrasing!, composition: { ...DEFAULT_COMPOSITION } } };
  assert.deepEqual(parsePerformance(JSON.stringify(recipe)), expected);
  assert.deepEqual(decodeShareState(encodeShareState(recipe)), expected);
  for (const composition of [null, [], {}, { ...DEFAULT_COMPOSITION, unknown: .5 },
    { ...DEFAULT_COMPOSITION, development: NaN }, { ...DEFAULT_COMPOSITION, accent: Infinity },
    { ...DEFAULT_COMPOSITION, dynamicRange: -1 }, { ...DEFAULT_COMPOSITION, cohesion: 2 }]) {
    const malformed = { ...recipe, phrasing: { ...recipe.phrasing!, composition } };
    assert.throws(() => parsePerformance(JSON.stringify(malformed)));
    assert.throws(() => serializePerformance(malformed as unknown as Performance));
  }
  const isolated = parsePerformance(JSON.stringify(expected));
  isolated.phrasing!.composition!.repetition = 0;
  assert.equal(expected.phrasing.composition.repetition, DEFAULT_COMPOSITION.repetition);
});

test('complete phrased frames replay after live edits across phrase, meter and tuning boundaries', () => {
  let recipe = createPerformance('phrasing-replay-呼吸');
  recipe.conductor = { ...DEFAULT_CONDUCTOR, pace: 1 };
  recipe.phrasing = { ...DEFAULT_PHRASING };
  const live = composer(recipe), committed: Frame[] = [];
  for (let frame = 0; frame < 5; frame++) committed.push(live.step());
  const editTick = live.tick;
  recipe = recordLiveParameters(recipe, { melodicActivity: .83, rhythmicComplexity: .78, dynamics: .66 }, editTick);
  live.setAutomation(recipe.automation, recipe.automationRevisions);
  for (let frame = 0; frame < 9; frame++) committed.push(live.step());
  const rampStart = live.tick + FRAME_TICKS, rampEnd = rampStart + FRAME_TICKS * 5;
  recipe = scheduleParameterTransition(recipe, 'tempo', rampStart, rampEnd, 114, 'smooth', live.tick);
  live.setAutomation(recipe.automation, recipe.automationRevisions);
  while (formAt(recipe.seed, live.tick, recipe.conductor!).cycle < 2 && committed.length < 640) committed.push(live.step());
  assert.ok(committed.length < 640, 'The fixture covers two complete bounded journeys, including their actually composed metrical residences.');

  assert.ok(committed.every(frame => frame.phrase), 'This fixture must exercise the enabled phrase engine.');
  assert.ok(new Set(committed.map(frame => frame.phrase!.phraseId)).size >= 8);
  const sections = committed.filter((frame, index) => index === 0 || frame.form!.sectionIndex !== committed[index - 1].form!.sectionIndex);
  for (const cycle of [0, 1]) {
    const away = sections.filter(frame => frame.form!.cycle === cycle && frame.sound.tuning !== recipe.sound.tuning);
    assert.ok(away.length >= 3 && away.length <= 4, 'Replay must cover each complete inhabited native excursion.');
    assert.equal(new Set(away.map(frame => frame.sound.tuning)).size, 1);
    assert.equal(away.at(-1)!.form!.sectionIndex - away[0].form!.sectionIndex + 1, away.length);
  }
  assert.equal(committed[0].sound.tuning, recipe.sound.tuning);
  assert.equal(committed.at(-1)!.sound.tuning, recipe.sound.tuning);
  const changes = committed.filter((frame, index) => index > 0 && frame.sound.tuning !== committed[index - 1].sound.tuning);
  assert.equal(changes.length, 4);
  assert.ok(changes.every(frame => frame.form!.gliding && frame.notes.some(note => note.endPitch
    && note.endPitch.millicents !== note.absolutePitch!.millicents)), 'Both native entry and homecoming must sound real glides.');
  for (const frame of committed) for (const pitch of [...frame.voicePitches, frame.bassPitch]) {
    assert.deepEqual(degreeToPitch(frame.sound.tuning, pitchToDegree(frame.sound.tuning, pitch)), pitch,
      'Destination voices must use the actually declared native grid, including 24/31-EDO routes.');
  }
  const signatures = new Set(committed.map(frame => `${frame.form!.meter.numerator}/${frame.form!.meter.denominator}`));
  assert.ok(signatures.size >= 1);
  for (const frame of committed) {
    const form = frame.form!;
    const source = themeIds(recipe.seed).map(themeId => rhythmicHomeFor(recipe.seed, themeId))
      .find(home => home.cell.id === form.meterSourceId)!;
    assert.ok(source, 'Every signature and grouping comes from an actual serialized-seed thematic source.');
    assert.deepEqual(form.meter, source.meter);
    assert.deepEqual(form.meterGroups, source.groups);
    assert.equal(form.meterGroups!.reduce((sum, group) => sum + group, 0), form.meter.numerator);
    assert.ok(form.meterResidenceStartTick! <= frame.tick);
  }
  assert.ok(committed.filter(frame => frame.tick >= editTick).every(frame => frame.parameters.melodicActivity === .83 && frame.parameters.rhythmicComplexity === .78));
  assert.ok(committed.filter(frame => frame.tick >= rampEnd).every(frame => frame.parameters.tempo === 114));

  const restored = parsePerformance(serializePerformance(recipe));
  const replay = composer(restored);
  const replayed = Array.from({ length: committed.length }, () => replay.step());
  assert.deepEqual(replayed.map(frame => ({ meter: frame.form!.meter, source: frame.form!.meterSourceId,
    groups: frame.form!.meterGroups, residenceStart: frame.form!.meterResidenceStartTick, reason: frame.form!.meterReason })),
  committed.map(frame => ({ meter: frame.form!.meter, source: frame.form!.meterSourceId,
    groups: frame.form!.meterGroups, residenceStart: frame.form!.meterResidenceStartTick, reason: frame.form!.meterReason })));
  assert.deepEqual(replayed, committed);
  assert.deepEqual(decodeShareState(encodeShareState(recipe)), restored);
});
