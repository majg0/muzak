import test from 'node:test';
import assert from 'node:assert/strict';
import { adjacentMarkerTick, clampViewport, panViewport, precedingMarker, resizeViewport, zoomViewport } from '../src/score/navigation';

test('view panning preserves span and clamps both score edges without mutating its input', () => {
  const original = { from: 100, to: 300 };
  assert.deepEqual(panViewport(original, -500, 1000), { from: 0, to: 200 });
  assert.deepEqual(panViewport(original, 1000, 1000), { from: 800, to: 1000 });
  assert.deepEqual(original, { from: 100, to: 300 });
});
test('pointer-anchored zoom preserves score coordinate at its relative view position', () => {
  assert.deepEqual(zoomViewport({ from: 100, to: 500 }, .5, 400, 1000), { from: 250, to: 450 });
  assert.deepEqual(zoomViewport({ from: 250, to: 450 }, 2, 400, 1000), { from: 100, to: 500 });
  assert.deepEqual(zoomViewport({ from: 0, to: 100 }, 100, 25, 1000), { from: 0, to: 1000 });
  assert.deepEqual(zoomViewport({ from: 100, to: 500 }, .00001, 200, 1000, 12), { from: 197, to: 209 });
});
test('resize handles retain the opposite edge and cannot cross or shrink past minimum', () => {
  const view = { from: 100, to: 500 };
  assert.deepEqual(resizeViewport(view, 'start', 999, 1000, 12), { from: 488, to: 500 });
  assert.deepEqual(resizeViewport(view, 'end', -10, 1000, 12), { from: 100, to: 112 });
  assert.deepEqual(resizeViewport(view, 'end', 2000, 1000), { from: 100, to: 1000 });
  assert.deepEqual(resizeViewport(view, 'start', -2000, 1000), { from: 0, to: 500 });
});
test('empty, tiny and invalid coordinate domains remain explicit', () => {
  assert.deepEqual(clampViewport({ from: 10, to: 50 }, 0), { from: 0, to: 0 });
  assert.deepEqual(clampViewport({ from: 10, to: 50 }, 3, 12), { from: 0, to: 3 });
  assert.throws(() => zoomViewport({ from: 0, to: 1 }, 0, 0, 2), /zoom/);
  assert.throws(() => clampViewport({ from: NaN, to: 2 }, 100), /coordinates/);
});

test('transport marker lookup uses supplied changing-meter coordinates without assuming quarter beats', () => {
  const markers = [{tick: 0, label: '1:1'}, {tick: 240, label: '1:2'}, {tick: 480, label: '2:1'}, {tick: 1440, label: '2:2'}];
  assert.equal(precedingMarker(markers, 479)?.label, '1:2');
  assert.equal(precedingMarker(markers, 480)?.label, '2:1');
  assert.equal(adjacentMarkerTick(markers, 480, 1, 2000), 1440);
  assert.equal(adjacentMarkerTick(markers, 481, -1, 2000), 480);
  assert.equal(adjacentMarkerTick(markers, 0, -1, 2000), 0);
  assert.equal(adjacentMarkerTick(markers, 1440, 1, 2000), 2000);
});

test('fractional ruler markers that share an integer transport tick cannot trap keyboard seeking', () => {
  const markers = [{tick: 0}, {tick: .25}, {tick: .5}, {tick: .75}, {tick: 1}, {tick: 1.5}, {tick: 2}];
  assert.equal(adjacentMarkerTick(markers, 1, -1, 2), 0);
  assert.equal(adjacentMarkerTick(markers, 1, 1, 2), 2);
  assert.equal(precedingMarker([], 0), undefined);
  assert.equal(adjacentMarkerTick([], 12, 1, 100), 100);
});
