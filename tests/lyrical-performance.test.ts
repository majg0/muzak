import test from 'node:test';
import assert from 'node:assert/strict';
import { lyricalPerformance } from '../src/lyrical';
import { explorationPerformance } from '../src/exploration';
import { createPerformance, parsePerformance, serializePerformance, encodeShareState, decodeShareState } from '../src/serialization';
import { DEFAULT_PHRASING, normalizePhrasing, validatePhrasing } from '../src/phrasing';

test('lyrical direction is a complete serializable recipe while preserving seed and chosen sound', () => {
  const source = createPerformance('warm-meadow');
  source.sound.tuning = '19edo';
  source.sound.instrument = 'additive';
  source.initialParameters.tempo = 140;
  source.bookmarks = [{ id: 'old', tick: 960, name: 'Previous interpretation' }];
  source.automation = [{ parameter: 'tension', points: [{ tick: 0, value: .9 }] }];
  const before = structuredClone(source);
  const { recipe } = lyricalPerformance(source);
  assert.deepEqual(source, before);
  assert.equal(recipe.seed, source.seed);
  assert.deepEqual(recipe.sound, source.sound);
  assert.equal(recipe.phrasing?.character, 'lyrical');
  assert.equal(recipe.conductor?.tuningTravel, false);
  assert.equal(recipe.phrasing?.composition?.dynamicRange, .88);
  assert.equal(recipe.phrasing?.composition?.transition, .35);
  assert.equal(recipe.phrasing?.composition?.displacement, .2);
  assert.equal(recipe.phrasing?.virtuosity, .1, 'Broader orchestral expression retains the restrained melodic recipe.');
  assert.equal(recipe.initialParameters.tempo, 96);
  assert.deepEqual(recipe.automation, []);
  assert.deepEqual(recipe.bookmarks, []);
  assert.deepEqual(parsePerformance(serializePerformance(recipe)), recipe);
  assert.deepEqual(decodeShareState(encodeShareState(recipe)), recipe);
  assert.equal(explorationPerformance(recipe, 'new').recipe.phrasing?.character, 'lyrical');
});

test('the legacy character schema validates imports before profile normalization', () => {
  assert.equal(normalizePhrasing(DEFAULT_PHRASING).character, undefined);
  assert.equal(validatePhrasing({ ...DEFAULT_PHRASING, character: 'lyrical' }).character, 'lyrical');
  assert.throws(() => validatePhrasing({ ...DEFAULT_PHRASING, character: 'unknown' }), /character/);
});
