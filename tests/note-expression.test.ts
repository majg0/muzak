import test from 'node:test';
import assert from 'node:assert/strict';
import { clipGainEnvelope, gainEnvelopeAt } from '../src/note-expression';

test('clipping held dynamics samples the existing swell rather than compressing its duration', () => {
  const original = [{ tick: 0, gain: .2 }, { tick: 960, gain: 1 }, { tick: 1920, gain: .4 }];
  const snapshot = structuredClone(original);
  assert.deepEqual(clipGainEnvelope(original, 1440), [{ tick: 0, gain: .2 }, { tick: 960, gain: 1 }, { tick: 1440, gain: .7 }]);
  const halfway = clipGainEnvelope(original, 480)!;
  assert.deepEqual(halfway.map(point => point.tick), [0, 480]);
  assert.ok(Math.abs(halfway[1].gain - .6) < 1e-12);
  assert.deepEqual(original, snapshot);
  assert.equal(gainEnvelopeAt(undefined, 100), 1);
  assert.equal(gainEnvelopeAt(original, 3000), .4);
});

test('zero gain and held endpoint knots remain valid; invalid musical envelopes fail explicitly', () => {
  assert.deepEqual(clipGainEnvelope([{ tick: 120, gain: 0 }, { tick: 480, gain: 1 }], 600), [{ tick: 0, gain: 0 }, { tick: 120, gain: 0 }, { tick: 480, gain: 1 }, { tick: 600, gain: 1 }]);
  for (const points of [[{ tick: 0, gain: NaN }], [{ tick: .5, gain: 1 }], [{ tick: 1, gain: 1 }, { tick: 1, gain: .2 }], [{ tick: 0, gain: 1.1 }]]) assert.throws(() => clipGainEnvelope(points, 960), /Gain-envelope/);
});
