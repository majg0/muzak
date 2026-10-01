import test from 'node:test';
import assert from 'node:assert/strict';
import { periodicField } from '../src/engine/periodic-field';
import { lyricalField } from '../src/engine/lyrical-support';
import { TUNINGS, type TuningId } from '../src/pitch';

test('native scale coordinates round-trip across positive and negative periods', () => {
  for (const tuning of Object.keys(TUNINGS) as TuningId[]) for (const third of [3, 4] as const) {
    const values = lyricalField(tuning, third).map(degree => degree * 1200 / TUNINGS[tuning].divisions);
    const field = periodicField(values);
    for (let index = -24; index <= 24; index++) {
      assert.equal(field.indexAt(field.at(index)), index);
      assert.ok(Math.abs(field.at(index + values.length) - field.at(index) - 1200) < 1e-9);
    }
  }
});

test('nearest scale positions cross a period boundary instead of sticking to its last local degree', () => {
  const field = periodicField(lyricalField('19edo', 3).map(degree => degree * 1200 / 19));
  assert.equal(field.indexAt(18 * 1200 / 19), 7);
  assert.equal(field.indexAt(-1200 / 19), 0);
  assert.equal(field.at(7), 1200);
  const nonOctave = periodicField([6, 0, 3, 3], 10);
  assert.equal(nonOctave.indexAt(9), 3);
  assert.equal(nonOctave.indexAt(-1), 0);
  assert.equal(nonOctave.indexAt(1.5), 0, 'An exact midpoint consistently chooses the lower position.');
  assert.equal(nonOctave.indexAt(-2), -1);
});

test('invalid or unaddressable fields fail without an unbounded search', () => {
  for (const values of [[], [NaN], [-1], [1200]]) assert.throws(() => periodicField(values), RangeError);
  for (const period of [0, -1, Infinity, NaN]) assert.throws(() => periodicField([0], period), RangeError);
  const field = periodicField([0, 200]);
  for (const index of [NaN, .5, Infinity, Number.MAX_VALUE]) assert.throws(() => field.at(index), RangeError);
  for (const value of [NaN, Infinity, Number.MAX_VALUE]) assert.throws(() => field.indexAt(value), RangeError);
  assert.throws(() => periodicField([0], Number.MIN_VALUE).indexAt(1), RangeError);
});
