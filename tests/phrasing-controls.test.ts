import test from 'node:test';
import assert from 'node:assert/strict';
import { eventHash } from '../src/engine/random';
import { DEFAULT_COMPOSITION } from '../src/composition';
import {
  DEFAULT_PHRASING, MANUAL_PHRASING, densityAt, envelopeAt, makeEnvelope,
  normalizePhrasing, sampleIntent, validatePhrasing,
  type DistributionShape, type EnvelopeShape,
} from '../src/phrasing';

const shapes: DistributionShape[] = ['focused', 'balanced', 'adventurous'];

test('phrasing imports preserve every explicit control and missing controls preserve legacy recipes', () => {
  const config = { ...DEFAULT_PHRASING, enabled: false, space: .123456789, variation: 1, distribution: 'adventurous' as const, arc: 'waves' as const };
  assert.deepEqual(validatePhrasing(JSON.parse(JSON.stringify(config))), config);
  assert.deepEqual(validatePhrasing(undefined), MANUAL_PHRASING);
  const restored = validatePhrasing(config);
  restored.space = 1;
  assert.equal(config.space, .123456789);
  assert.equal(validatePhrasing(undefined).enabled, false);
});

test('strict phrasing validation rejects malformed configuration while UI normalization is tolerant', () => {
  for (const malformed of [null, [], false, 3, 'arch', {}, { ...DEFAULT_PHRASING, space: -1 },
    { ...DEFAULT_PHRASING, variation: 1.01 }, { ...DEFAULT_PHRASING, interplay: NaN },
    { ...DEFAULT_PHRASING, renewal: Infinity }, { ...DEFAULT_PHRASING, enabled: 1 },
    { ...DEFAULT_PHRASING, arc: 'random' }, { ...DEFAULT_PHRASING, distribution: 'gaussian' },
    { ...DEFAULT_PHRASING, probabilityOfMinorNinth: .5 }]) assert.throws(() => validatePhrasing(malformed));
  const missing = { ...DEFAULT_PHRASING } as Partial<typeof DEFAULT_PHRASING>;
  delete missing.virtuosity;
  assert.throws(() => validatePhrasing(missing));
  assert.deepEqual(normalizePhrasing(), DEFAULT_PHRASING);
  const normalized = normalizePhrasing({ enabled: false, space: -5, syncopation: 3, variation: NaN });
  assert.equal(normalized.enabled, false);
  assert.equal(normalized.space, 0);
  assert.equal(normalized.syncopation, 1);
  assert.equal(normalized.variation, DEFAULT_PHRASING.variation);
});

test('nested composition controls are strict on import, default when absent, and independently normalized', () => {
  const { composition: _omitted, ...oldShape } = DEFAULT_PHRASING;
  assert.deepEqual(validatePhrasing(oldShape).composition, DEFAULT_COMPOSITION);
  assert.deepEqual(normalizePhrasing().composition, DEFAULT_COMPOSITION);
  for (const composition of [null, [], {}, false, { ...DEFAULT_COMPOSITION, accent: NaN },
    { ...DEFAULT_COMPOSITION, cohesion: Infinity }, { ...DEFAULT_COMPOSITION, repetition: 1.1 },
    { ...DEFAULT_COMPOSITION, development: -1 }, { ...DEFAULT_COMPOSITION, embellishment: '0.5' },
    { ...DEFAULT_COMPOSITION, unexpected: .5 }]) assert.throws(() => validatePhrasing({ ...DEFAULT_PHRASING, composition }));
  const composition = { ...DEFAULT_COMPOSITION, accent: -1, cohesion: 2, dynamicRange: NaN };
  const normalized = normalizePhrasing({ composition });
  assert.equal(normalized.composition!.accent, 0);
  assert.equal(normalized.composition!.cohesion, 1);
  assert.equal(normalized.composition!.dynamicRange, DEFAULT_COMPOSITION.dynamicRange);
  normalized.composition!.repetition = 0;
  assert.equal(composition.repetition, DEFAULT_COMPOSITION.repetition);
  const parsed = validatePhrasing(undefined);
  parsed.composition!.development = 0;
  assert.equal(MANUAL_PHRASING.composition!.development, DEFAULT_COMPOSITION.development);
  assert.equal(DEFAULT_PHRASING.composition!.development, DEFAULT_COMPOSITION.development);
});

test('envelopes provide bounded independent intent points and predictable interpolation', () => {
  const arcs: EnvelopeShape[] = ['arch', 'rise', 'fall', 'waves'];
  for (const arc of arcs) {
    const points = makeEnvelope(arc, .5, .4);
    assert.equal(points[0].position, 0);
    assert.equal(points.at(-1)!.position, 1);
    assert.ok(points.every((point, index) => point.value >= 0 && point.value <= 1 && (index === 0 || point.position > points[index - 1].position)));
    for (const point of points) assert.equal(envelopeAt(points, point.position), point.value);
    assert.equal(envelopeAt(points, -1), points[0].value);
    assert.equal(envelopeAt(points, 2), points.at(-1)!.value);
    assert.ok(makeEnvelope(arc, .99, 1).every(point => point.value >= 0 && point.value <= 1));
    const fresh = makeEnvelope(arc, .5, .4);
    points[0].value = 100;
    assert.deepEqual(makeEnvelope(arc, .5, .4), fresh);
  }
  assert.equal(envelopeAt(makeEnvelope('arch', .5, .4), .5), .9);
  assert.equal(envelopeAt(makeEnvelope('rise', .5, .4), .25), .3);
  assert.equal(envelopeAt(makeEnvelope('fall', .5, .4), .25), .7);
  assert.equal(envelopeAt([], .5), 0);
  assert.equal(envelopeAt([{ position: .5, value: .7 }], .1), .7);
  assert.ok(makeEnvelope('waves', .3, 0).every(point => point.value === .3));
});

test('displayed densities are normalized and focused and adventurous encode opposite preferences', () => {
  for (const shape of shapes) {
    const steps = 2_000, dx = 2 / steps;
    let integral = 0;
    for (let index = 0; index < steps; index++) {
      const left = -1 + index * dx;
      integral += (densityAt(left, shape) + densityAt(left + dx, shape)) * dx / 2;
    }
    assert.ok(Math.abs(integral - 1) < 1e-10, `${shape} integral ${integral}`);
    assert.equal(densityAt(-1.001, shape), 0);
    assert.equal(densityAt(1.001, shape), 0);
    assert.equal(densityAt(NaN, shape), 0);
    for (const x of [.1, .5, .8]) assert.equal(densityAt(x, shape), densityAt(-x, shape));
  }
  assert.ok(densityAt(0, 'focused') > densityAt(.9, 'focused'));
  assert.ok(densityAt(0, 'adventurous') < densityAt(.9, 'adventurous'));
  assert.equal(densityAt(0, 'balanced'), densityAt(.9, 'balanced'));
});

test('addressed intent is query-order independent, domain-isolated, bounded, and quantized', () => {
  const sample = (phrase: number, domain = 'activity') => shapes.map(shape => sampleIntent('夜の庭', phrase, domain, .5, .4, shape));
  const expected = Array.from({ length: 64 }, (_, phrase) => sample(phrase));
  for (let phrase = 63; phrase >= 0; phrase--) {
    sample(phrase, 'unrelated-new-orchestration-rule');
    assert.deepEqual(sample(phrase), expected[phrase]);
    assert.notDeepEqual(sample(phrase, 'register'), expected[phrase]);
  }
  for (const value of expected.flat()) {
    assert.ok(value >= .1 && value <= .9);
    assert.ok(Math.abs(value * 1_000_000 - Math.round(value * 1_000_000)) < 1e-8);
  }
  assert.equal(sampleIntent('s', 0, 'a', .123456789, 0, 'balanced'), .123457);
  assert.throws(() => sampleIntent('s', -1, 'a', .5, .5, 'balanced'));
  assert.throws(() => sampleIntent('s', 1.5, 'a', .5, .5, 'balanced'));
  assert.equal(eventHash(expected), '0d2370e5');
});

test('sampled intent follows the plotted density including bounded support near control limits', () => {
  const count = 32_768;
  for (const shape of shapes) {
    const histogram = new Array<number>(10).fill(0);
    let sum = 0, squares = 0, endpoints = 0;
    for (let phrase = 0; phrase < count; phrase++) {
      const value = sampleIntent('density-audit', phrase, 'activity', .02, .4, shape);
      assert.ok(value >= 0 && value <= .42);
      if (value === 0 || value === .42) endpoints++;
      const x = value / .42 * 2 - 1;
      sum += x;
      squares += x * x;
      histogram[Math.min(9, Math.floor((x + 1) * 5))]++;
    }
    for (let bin = 0; bin < 10; bin++) {
      const left = -1 + bin * .2, right = left + .2;
      // Each bin lies on a linear section, so the trapezoidal integral is exact.
      const expectedProbability = (densityAt(left, shape) + densityAt(right, shape)) * .1;
      assert.ok(Math.abs(histogram[bin] / count - expectedProbability) < .009, `${shape} bin ${bin}`);
    }
    const expectedVariance = shape === 'focused' ? 1 / 6 : shape === 'balanced' ? 1 / 3 : 1 / 2;
    assert.ok(Math.abs(sum / count) < .012, `${shape} mean`);
    assert.ok(Math.abs(squares / count - expectedVariance) < .01, `${shape} variance`);
    assert.ok(endpoints < count / 1_000, `${shape} must not accumulate clipped endpoints`);
  }
});
