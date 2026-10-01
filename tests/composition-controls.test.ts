import test from 'node:test';
import assert from 'node:assert/strict';
import { COMPOSITION_CONTROLS, DEFAULT_COMPOSITION, normalizeComposition, validateComposition, type CompositionConfig } from '../src/composition';
import { createPerformance, decodeShareState, encodeShareState, parsePerformance, serializePerformance } from '../src/serialization';

const sixControlRecipe: CompositionConfig = {
  development: .12, repetition: .23, embellishment: .34,
  cohesion: .45, accent: .56, dynamicRange: .67,
};

test('six-control composition inputs gain only the three new canonical defaults', () => {
  const expected = { ...sixControlRecipe, displacement: .72, polymeter: .58, transition: .55 };
  assert.deepEqual(validateComposition(sixControlRecipe), expected);
  assert.deepEqual(normalizeComposition(sixControlRecipe), expected);
  assert.deepEqual(validateComposition(undefined), DEFAULT_COMPOSITION);
  const recipe = createPerformance('old controls, new interpretation');
  recipe.phrasing!.composition = sixControlRecipe;
  assert.deepEqual(parsePerformance(JSON.stringify(recipe)).phrasing!.composition, expected);
  assert.deepEqual(decodeShareState(encodeShareState(recipe))!.phrasing!.composition, expected);
  assert.deepEqual(sixControlRecipe, { development: .12, repetition: .23, embellishment: .34, cohesion: .45, accent: .56, dynamicRange: .67 });
});

test('independent layer and transition controls survive exact JSON and URL round trips', () => {
  const recipe = createPerformance('layered-独立');
  recipe.phrasing!.composition = { ...sixControlRecipe, displacement: .123456789, polymeter: 0, transition: 1 };
  assert.deepEqual(parsePerformance(serializePerformance(recipe)), recipe);
  assert.deepEqual(decodeShareState(encodeShareState(recipe)), recipe);
  assert.deepEqual(COMPOSITION_CONTROLS.slice(-3).map(([key, label]) => [key, label]), [
    ['displacement', 'Independent layers'], ['polymeter', 'Cross-meter cycles'], ['transition', 'Transition energy'],
  ]);
});

test('provided malformed controls remain errors while normalization clamps finite inputs', () => {
  for (const key of ['displacement', 'polymeter', 'transition'] as const) {
    for (const value of [undefined, null, NaN, Infinity, -.01, 1.01, '.5', false, {}]) {
      assert.throws(() => validateComposition({ ...sixControlRecipe, [key]: value }), new RegExp(key));
    }
    assert.equal(normalizeComposition({ [key]: -2 })[key], 0);
    assert.equal(normalizeComposition({ [key]: 2 })[key], 1);
    assert.equal(normalizeComposition({ [key]: NaN })[key], DEFAULT_COMPOSITION[key]);
  }
  assert.throws(() => validateComposition({ ...DEFAULT_COMPOSITION, futureControl: .5 }), /unknown/);
  for (const key of Object.keys(sixControlRecipe)) {
    const incomplete = { ...DEFAULT_COMPOSITION } as Record<string, unknown>;
    delete incomplete[key];
    assert.throws(() => validateComposition(incomplete), new RegExp(key));
  }
  const independent = validateComposition(undefined);
  independent.displacement = 0;
  assert.equal(DEFAULT_COMPOSITION.displacement, .72);
});
