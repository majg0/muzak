import test from 'node:test';
import assert from 'node:assert/strict';
import { explorationPerformance } from '../src/exploration';
import { createPerformance, serializePerformance, parsePerformance } from '../src/serialization';
import { MusicEngine, eventHash } from '../src/engine';
import { OrchestrationObserver } from '../src/engine/orchestration-observer';
import { midiToPitch } from '../src/pitch';
import type { NoteEvent } from '../src/types';
import { lyricalPerformance } from '../src/lyrical';
import { DEFAULT_CONDUCTOR } from '../src/conductor';
import { DEFAULT_PHRASING } from '../src/phrasing';
import { resolveCompositionProfile } from '../src/composition-profile';

test('exploration composes different parameter recipes reproducibly and keeps chosen BPM and sound', () => {
  const source = createPerformance('old-seed');
  source.initialParameters.tempo = 113;
  source.automation = [{ parameter: 'tempo', points: [{ tick: 0, value: 151 }] }];
  source.bookmarks = [{ id: 'old', tick: 480, name: 'old location' }];
  const before = structuredClone(source);
  const results = Array.from({ length: 32 }, (_, index) => explorationPerformance(source, `exploration-${index}`));
  assert.deepEqual(source, before);
  assert.deepEqual(results[0], explorationPerformance(source, 'exploration-0'));
  assert.equal(new Set(results.map(result => JSON.stringify(result.recipe.phrasing))).size, 32);
  for (const key of ['rhythmicDensity', 'chromaticism', 'melodicActivity', 'harmonicMobility'] as const) {
    const values = results.map(result => result.recipe.initialParameters[key]);
    assert.ok(Math.max(...values) - Math.min(...values) > .45);
  }
  for (const { recipe } of results) {
    assert.equal(recipe.initialParameters.tempo, 113);
    assert.deepEqual(recipe.sound, source.sound);
    assert.deepEqual(recipe.weights, source.weights);
    assert.deepEqual(recipe.automation, []);
    assert.deepEqual(recipe.bookmarks, []);
    assert.deepEqual(parsePerformance(serializePerformance(recipe)), recipe);
    assert.deepEqual(resolveCompositionProfile(recipe), { conductor: recipe.conductor, phrasing: recipe.phrasing });
  }
});

test('style recipes share mandatory composition while retaining contrasting musical controls', () => {
  const source = createPerformance('shared-plan');
  source.conductor = { ...DEFAULT_CONDUCTOR, enabled: false };
  source.phrasing = { ...DEFAULT_PHRASING, enabled: false, character: 'exploratory' };
  delete source.phrasing.harmony;
  const before = structuredClone(source);
  const singing = lyricalPerformance(source).recipe;
  const wide = explorationPerformance(source, 'wide-same-engine').recipe;
  assert.deepEqual(source, before, 'Applying a style does not rewrite the archived source.');
  for (const recipe of [singing, wide]) {
    assert.equal(recipe.conductor?.enabled, true);
    assert.equal(recipe.phrasing?.enabled, true);
    assert.equal(recipe.phrasing?.character, 'lyrical');
    assert.ok(recipe.phrasing?.harmony);
    assert.ok(recipe.phrasing?.composition);
    assert.deepEqual(parsePerformance(serializePerformance(recipe)), recipe);
  }
  assert.ok(wide.phrasing!.composition!.dynamicRange! > singing.phrasing!.composition!.dynamicRange!);
  assert.ok(wide.phrasing!.composition!.embellishment > singing.phrasing!.composition!.embellishment);
  assert.ok(wide.phrasing!.virtuosity > singing.phrasing!.virtuosity);
  assert.notDeepEqual(wide.initialParameters, singing.initialParameters);
});

test('a serialized exploration reproduces actual composition and its orchestral observations', () => {
  const { recipe } = explorationPerformance(createPerformance('old'), 'wide-review');
  const render = () => {
    const restored = parsePerformance(serializePerformance(recipe));
    const engine = new MusicEngine({ ...restored, parameters: restored.initialParameters });
    return Array.from({ length: 32 }, () => engine.step());
  };
  assert.deepEqual(render(), render());
  const hashes = Array.from({ length: 4 }, (_, i) => {
    const { recipe } = explorationPerformance(createPerformance('old'), `wide-${i}`);
    const engine = new MusicEngine({ ...recipe, parameters: recipe.initialParameters });
    return eventHash(Array.from({ length: 24 }, () => engine.step()).flatMap(frame => frame.notes));
  });
  assert.equal(new Set(hashes).size, 4);
});

test('orchestral observations use notes, not requested drive; replaced holds cannot reappear', () => {
  const note: NoteEvent = { id: 'held', tick: 0, duration: 6000, absolutePitch: midiToPitch(60), velocity: .8, voice: 0, part: 'harmony' };
  const observer = new OrchestrationObserver();
  const start = observer.measure([note], 0, 960, 0);
  assert.equal(start.requestedEnergy, 0);
  assert.equal(start.activeVoices, 1);
  assert.equal(start.attacksPerBeat, .5);
  assert.ok(start.heldGainProxy > .6);
  observer.measure([{ ...note, id: 'cut', tick: 960, duration: 120 }], 960, 960, 1);
  observer.measure([], 1920, 960, 1);
  const silence = observer.measure([], 2880, 960, 1);
  assert.equal(silence.activeVoices, 0);
  assert.equal(silence.heldGainProxy, 0);
  assert.equal(silence.requestedEnergy, 1);
  assert.equal(note.duration, 6000, 'observing never changes committed notes');
});
