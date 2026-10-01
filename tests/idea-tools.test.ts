import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseGesture, GESTURE_OPERATIONS, proposeGestures, transformGesture,
  type Gesture, type GestureContext, type GestureOperation } from '../src/engine/idea-tools';

const source: Gesture = { sourceId: 'shared-subject', operations: [], notes: [0, 2, 4, 3].map((degree, index) => ({
  degree, units: [1, 2, 1, 2][index], strength: [1, .5, .8, 1][index],
})) };
const degrees = (gesture: Gesture) => gesture.notes.map(note => note.degree);
const context: GestureContext = { from: 0, target: 3, count: 4, development: .7, familiarity: .6, closing: false };

test('gesture operations compose in order without modifying source notes or provenance', () => {
  const original = structuredClone(source);
  const a: GestureOperation[] = [{ kind: 'transpose', degrees: 3 }];
  const b: GestureOperation[] = [{ kind: 'invert', axis: 0 }, { kind: 'time-scale', factor: 2 }];
  const composed = transformGesture(source, [...a, ...b]);
  assert.deepEqual(composed, transformGesture(transformGesture(source, a), b));
  assert.notDeepEqual(degrees(composed), degrees(transformGesture(source, [...b, ...a])));
  assert.equal(composed.sourceId, source.sourceId);
  assert.deepEqual(composed.operations, [...a, ...b]);
  assert.deepEqual(source, original);
  assert.notStrictEqual(composed.notes[0], source.notes[0]);
  if (a[0].kind === 'transpose') a[0].degrees = 9;
  assert.equal((composed.operations[0] as { degrees: number }).degrees, 3);
});

test('reversal, fragmentation and scaling preserve the declared pitch-rhythm relationship', () => {
  assert.deepEqual(transformGesture(source, [{ kind: 'retrograde' }]).notes, [...source.notes].reverse());
  assert.deepEqual(degrees(transformGesture(source, [{ kind: 'fragment', start: 1, count: 2 }])), [2, 4]);
  assert.deepEqual(degrees(transformGesture(source, [{ kind: 'interval-scale', factor: .5 }])), [0, 1, 2, 2]);
  assert.deepEqual(degrees(transformGesture(source, [{ kind: 'invert' }])), [0, -2, -4, -3]);
  assert.deepEqual(transformGesture(source, [{ kind: 'time-scale', factor: .5 }]).notes.map(note => note.units), [.5, 1, .5, 1]);
});

test('extension continues the last interval rather than cycling a small source forever', () => {
  const extended = transformGesture(source, [{ kind: 'extend', count: 8 }]);
  assert.equal(extended.notes.length, 12);
  assert.deepEqual(degrees(extended).slice(4), [2, 1, 0, -1, -2, -3, -4, -5]);
  const remembered = transformGesture(extended, [{ kind: 'fragment', start: 4, count: 4 }, { kind: 'retrograde' }]);
  assert.deepEqual(degrees(remembered), [-1, 0, 1, 2]);
  assert.equal(remembered.sourceId, source.sourceId);
  assert.equal(remembered.operations.length, 3);
});

test('scalar, arpeggio and pedal operations declare a destination and a complete direction', () => {
  assert.deepEqual(degrees(transformGesture(source, [{ kind: 'connect', target: -5, count: 3 }])), [-2, -3, -5]);
  for (const target of [-7, 7]) {
    const arpeggio = transformGesture(source, [{ kind: 'arpeggiate', target, count: 6, pitchClasses: [0, 2, 4] }]);
    assert.equal(arpeggio.notes.length, 6);
    assert.equal(arpeggio.notes.at(-1)!.degree, target);
    assert.ok(arpeggio.notes.every(note => [0, 2, 4].includes(((note.degree % 7) + 7) % 7)));
    assert.ok(arpeggio.notes.every((note, index) => Math.sign(note.degree - (arpeggio.notes[index - 1]?.degree ?? 0)) === Math.sign(target)
      || note.degree === (arpeggio.notes[index - 1]?.degree ?? 0)));
  }
  const pedal = transformGesture(source, [{ kind: 'pedal', degree: 4, count: 6 }]);
  assert.deepEqual(degrees(pedal), [4, 4, 4, 4, 4, 4]);
  assert.ok(pedal.notes.some(note => note.strength === .5) && pedal.notes.some(note => note.strength === 1));
});

test('invalid or explosive transformations fail before returning corrupt material', () => {
  const bad: GestureOperation[] = [
    { kind: 'transpose', degrees: NaN }, { kind: 'invert', axis: Infinity },
    { kind: 'interval-scale', factor: Number.MAX_VALUE }, { kind: 'time-scale', factor: 0 },
    { kind: 'extend', count: 128 }, { kind: 'fragment', start: 8, count: 1 },
    { kind: 'connect', target: 2.5, count: 4 }, { kind: 'pedal', degree: 0, count: 129 },
    { kind: 'arpeggiate', target: 1, count: 4, pitchClasses: [0, 2, 4] },
    { kind: 'arpeggiate', target: 7, count: 4, pitchClasses: [0], period: 0 },
  ];
  for (const operation of bad) assert.throws(() => transformGesture(source, [operation]), RangeError, operation.kind);
  assert.throws(() => transformGesture({ ...source, notes: [] }, []), RangeError);
  assert.throws(() => transformGesture({ ...source, notes: [{ degree: 0, units: Infinity, strength: .5 }] }, []), RangeError);
  assert.throws(() => transformGesture({ ...source, notes: [{ degree: 0, units: 1, strength: 1.1 }] }, []), RangeError);
  assert.throws(() => transformGesture(source, [{ kind: 'unknown' } as unknown as GestureOperation]), RangeError);
});

test('every proposed chain satisfies cardinality, destination, register and incoming leap constraints', () => {
  for (const from of [-7, -2, 0, 5, 12]) for (const target of [-7, 0, 4, 12]) for (const count of [1, 2, 5, 8]) {
    const request = { ...context, from, target, count, maximumLeap: 4 };
    if (Math.abs(target - from) > count * 4) continue;
    const proposed = proposeGestures(source, request);
    assert.ok(proposed.length > 0, JSON.stringify(request));
    assert.equal(new Set(proposed.map(candidate => candidate.id)).size, proposed.length);
    for (const candidate of proposed) {
      const notes = candidate.gesture.notes;
      assert.equal(notes.length, count); assert.equal(notes.at(-1)!.degree, target);
      assert.ok(notes.every((note, index) => note.degree >= -7 && note.degree <= 12
        && Math.abs(note.degree - (notes[index - 1]?.degree ?? from)) <= 4));
      assert.equal(candidate.gesture.sourceId, source.sourceId);
    }
  }
  assert.throws(() => proposeGestures(source, { ...context, from: -7, target: 12, count: 2, maximumLeap: 4 }), /cannot reach/);
  assert.throws(() => proposeGestures(source, { ...context, maximumLeap: 8 }), RangeError);
});

test('the proposal vocabulary exposes real operations and chooses evaluated coherent material', () => {
  const proposed = proposeGestures(source, { ...context, target: 4, count: 5 });
  const operations = new Set(proposed.flatMap(candidate => candidate.gesture.operations.map(operation => operation.kind)));
  for (const name of Object.keys(GESTURE_OPERATIONS)) assert.ok(operations.has(name as GestureOperation['kind']), name);
  const before = structuredClone(source);
  const result = chooseGesture('idea-tools', 'phrase:3:motif:1', source, context);
  assert.ok(result.candidateCount >= 3 && Object.values(result.costs).every(value => Number.isFinite(value) && value >= 0));
  assert.deepEqual(result, chooseGesture('idea-tools', 'phrase:3:motif:1', source, context));
  assert.deepEqual(source, before);
  const familiar = chooseGesture('idea-tools', 'literal-return', source, { ...context, familiarity: 1, development: 0 });
  assert.deepEqual(familiar.gesture.notes, source.notes);
  assert.equal(familiar.costs.identity, 0);
});

test('closed gestures approach their endpoint in one direction', () => {
  for (const target of [-5, 0, 8]) {
    const request = { ...context, from: 2, target, count: 5, closing: true, maximumLeap: 3 };
    for (const candidate of proposeGestures(source, request)) {
      assert.ok(Math.abs(candidate.gesture.notes.at(-2)!.degree - target) <= 1, 'The final arrival has a prepared scalar approach.');
      let previous = request.from;
      for (const note of candidate.gesture.notes) {
        assert.ok(Math.abs(target - note.degree) <= Math.abs(target - previous));
        assert.ok(note.degree >= Math.min(target, request.from) && note.degree <= Math.max(target, request.from));
        previous = note.degree;
      }
    }
  }
  assert.throws(() => proposeGestures(source, { ...context, from: -7, target: 12, count: 3, maximumLeap: 7, closing: true }), /cannot reach/);
  assert.ok(proposeGestures(source, { ...context, from: -7, target: 12, count: 3, maximumLeap: 7 }).length > 0);
});

test('augmentation and diminution answer parent duration without forcing a different pitch argument', () => {
  const originalUnits = source.notes.reduce((sum, note) => sum + note.units, 0);
  for (const durationRatio of [.3, .5, 1, 2]) {
    const request = { ...context, durationRatio, familiarity: 1, development: 0 };
    const proposals = proposeGestures(source, request);
    assert.ok(proposals.length > 0);
    assert.ok(proposals.every(candidate => candidate.gesture.notes.reduce((sum, note) => sum + note.units, 0) <= originalUnits * durationRatio * (1 + 1e-10)));
    const result = chooseGesture('parent-budget', `duration-${durationRatio}`, source, request);
    assert.deepEqual(degrees(result.gesture), degrees(source));
    assert.ok(Math.abs(result.gesture.notes.reduce((sum, note) => sum + note.units, 0) - originalUnits * durationRatio) < 1e-10);
    assert.ok(result.costs.duration < 1e-10);
    if (durationRatio !== 1) assert.ok(result.gesture.operations.some(operation => operation.kind === 'time-scale'));
  }
  const forcedConnection = chooseGesture('parent-budget', 'far-arrival', source,
    { ...context, from: -7, target: 12, count: 4, maximumLeap: 7, closing: true, durationRatio: .1 });
  assert.equal(forcedConnection.gesture.notes.at(-1)!.degree, 12);
  assert.ok(forcedConnection.gesture.operations.some(operation => operation.kind === 'connect'));
});

test('development permits substantial evaluated departure while familiarity retains the source', () => {
  const original = chooseGesture('development', 'same-address', source, { ...context, development: 1, familiarity: 1 });
  const developed = chooseGesture('development', 'same-address', source, { ...context, development: 1, familiarity: 0 });
  assert.deepEqual(degrees(original.gesture), degrees(source));
  assert.notDeepEqual(degrees(developed.gesture), degrees(source));
  assert.ok(developed.gesture.operations.some(operation => !['transpose', 'time-scale'].includes(operation.kind)));
  assert.equal(developed.gesture.notes.at(-1)!.degree, context.target);
});

test('familiarity does not disguise a distant destination as unsupported repeated landings', () => {
  const repeatedArrival: Gesture = { sourceId: 'wide-head', operations: [],
    notes: [2, 7, 7].map(degree => ({ degree, units: 1, strength: .8 })) };
  const request = { ...context, from: 7, target: 3, count: 3, familiarity: 1, development: 0 };
  for (const closing of [false, true]) {
    const selected = chooseGesture('familiar-connection', 'destination', repeatedArrival, { ...request, closing });
    assert.ok(selected.gesture.notes.some(note => note.degree !== request.target));
    assert.equal(selected.costs.repetition, 0);
    assert.equal(selected.gesture.notes.at(-1)!.degree, request.target);
  }
  const literal = chooseGesture('familiar-connection', 'source-return', repeatedArrival, { ...request, from: 2, target: 7 });
  assert.deepEqual(literal.gesture.notes, repeatedArrival.notes);
  assert.equal(literal.costs.repetition, 0, 'The source can deliberately repeat its own landing.');
  const held = transformGesture(repeatedArrival, [{ kind: 'pedal', degree: 3, count: 3 }]);
  const residence = chooseGesture('familiar-connection', 'residence', held, { ...request, from: 3 });
  assert.deepEqual(degrees(residence.gesture), [3, 3, 3]); assert.equal(residence.costs.repetition, 0);
  const single = chooseGesture('familiar-connection', 'single-arrival', repeatedArrival, { ...request, count: 1 });
  assert.equal(single.costs.repetition, 0);
});
