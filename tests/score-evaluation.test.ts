import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateBoundaries, evaluateOccurrences, MAX_OCCURRENCES, type BoundaryOptions, type Occurrence } from '../src/score/evaluation';

const options: BoundaryOptions = { unit: 'quarters', tolerance: 1, span: [0, 20], endpoints: 'include' };
const boundary = (reference: number[], estimated: number[], config = options) => evaluateBoundaries(estimated, [{ id: 'analyst', boundaries: reference }], config)[0];
const occurrence = (id: string, members: string[]): Occurrence => ({ id, members });
const membership = (reference: Occurrence[], estimated: Occurrence[]) => evaluateOccurrences(estimated, [{ id: 'analyst', occurrences: reference }])[0];
const prf = (result: { precision: number; recall: number; f1: number }) => [result.precision, result.recall, result.f1];

test('boundary matching is maximum-cardinality, inclusive, one-to-one and independent of input order', () => {
  // Nearest-first consumes 1.5 -> 1 and loses 0 -> 1. The optimal match has two.
  const result = boundary([1.5, 0], [2.5, 1]);
  assert.deepEqual(prf(result), [1, 1, 1]);
  assert.deepEqual(result.matches.map(pair => [pair.referenceIndex, pair.estimatedIndex, pair.distance]), [[1, 1, 1], [0, 0, 1]]);
  const crowded = boundary([4, 5, 6], [5]);
  assert.equal(crowded.matches.length, 1);
  assert.equal(crowded.precision, 1);
  assert.equal(crowded.recall, 1 / 3);
  assert.equal(crowded.f1, 0.5);
  assert.deepEqual(boundary([4], [4.5], { ...options, tolerance: 0 }).matches, []);
});

test('endpoint policy removes only explicit span endpoints and never clips or invents boundaries', () => {
  const reference = [0, 4, 8, 20], estimated = [0, 5, 9, 20];
  const result = boundary(reference, estimated, { ...options, endpoints: 'exclude' });
  assert.equal(result.referenceCount, 2);
  assert.equal(result.estimatedCount, 2);
  assert.deepEqual(result.excludedReferenceIndices, [0, 3]);
  assert.deepEqual(result.excludedEstimatedIndices, [0, 3]);
  assert.deepEqual(reference, [0, 4, 8, 20]);
  assert.deepEqual(estimated, [0, 5, 9, 20]);
  assert.equal(boundary([4, 8], [4, 8], { ...options, endpoints: 'exclude' }).matches.length, 2);
  assert.throws(() => boundary([0, 20], [21]), /inside the explicit span/);
  assert.throws(() => boundary([0, 0], [], { ...options, endpoints: 'exclude' }), /Duplicate/);
});

test('boundary inputs reject invalid coordinates, tolerances and ambiguous reference identities', () => {
  for (const invalid of [NaN, Infinity, -1, 21]) assert.throws(() => boundary([invalid], []), /finite/);
  for (const tolerance of [-1, Infinity, NaN]) assert.throws(() => boundary([], [], { ...options, tolerance }), /Invalid boundary|finite/);
  assert.throws(() => boundary([], [], { ...options, span: [2, 1] }), /Invalid boundary/);
  assert.throws(() => boundary([], [], { ...options, unit: '' }), /Invalid boundary/);
  assert.throws(() => evaluateBoundaries([], [{ id: 'same', boundaries: [] }, { id: 'same', boundaries: [] }], options), /unique/);
});

test('empty-set conventions are explicit for both metrics', () => {
  assert.deepEqual(prf(boundary([], [])), [1, 1, 1]);
  assert.deepEqual(prf(boundary([4], [])), [1, 0, 0]);
  assert.deepEqual(prf(boundary([], [4])), [0, 1, 0]);
  assert.deepEqual(prf(membership([], [])), [1, 1, 1]);
  assert.deepEqual(prf(membership([occurrence('r', ['a'])], [])), [1, 0, 0]);
  assert.deepEqual(prf(membership([], [occurrence('e', ['a'])])), [0, 1, 0]);
  assert.deepEqual(evaluateOccurrences([], []), []);
  assert.deepEqual(evaluateBoundaries([], [], options), []);
});

test('occurrence assignment maximizes total shared membership instead of taking the largest pair greedily', () => {
  // Intersection matrix [[3,2],[2,0]]: taking 3 greedily loses the optimal 2+2.
  const truth = [occurrence('r1', ['a', 'b', 'c', 'd', 'e']), occurrence('r2', ['f', 'g'])];
  const prediction = [occurrence('e1', ['a', 'b', 'c', 'f', 'g']), occurrence('e2', ['d', 'e'])];
  const original = structuredClone({ truth, prediction }), result = membership(truth, prediction);
  assert.equal(result.matchedMembers, 4);
  assert.deepEqual(prf(result), [4 / 7, 4 / 7, 4 / 7]);
  assert.deepEqual(result.matches.map(pair => [pair.referenceId, pair.estimatedId, pair.sharedMembers]), [['r1', 'e2', 2], ['r2', 'e1', 2]]);
  assert.deepEqual({ truth, prediction }, original);
  assert.equal(membership([...truth].reverse(), [...prediction].reverse()).matchedMembers, 4);
});

test('exact assignment agrees with independent exhaustive search across every binary 3-by-3 overlap graph', () => {
  const exhaustive = (weights: number[][], row = 0, used = 0): number => {
    if (row === weights.length) return 0;
    let best = exhaustive(weights, row + 1, used); // Leave this row unmatched.
    for (let column = 0; column < weights[row].length; column++) if (!(used & 1 << column)) {
      best = Math.max(best, weights[row][column] + exhaustive(weights, row + 1, used | 1 << column));
    }
    return best;
  };
  for (let bits = 0; bits < 512; bits++) {
    const truth = Array.from({ length: 3 }, (_, i) => occurrence(`r${i}`, [`reference-only-${i}`]));
    const predicted = Array.from({ length: 3 }, (_, i) => occurrence(`e${i}`, [`estimated-only-${i}`]));
    const weights = Array.from({ length: 3 }, () => Array<number>(3).fill(0));
    for (let r = 0; r < 3; r++) for (let e = 0; e < 3; e++) if (bits & 1 << (r * 3 + e)) {
      // Varied weights as well as every edge topology, without sharing a member
      // outside its chosen row/column intersection.
      const count = 1 + (bits + r + e) % 3;
      weights[r][e] = count;
      for (let k = 0; k < count; k++) {
        const key = `${r}/${e}/${k}`;
        (truth[r].members as string[]).push(key); (predicted[e].members as string[]).push(key);
      }
    }
    assert.equal(membership(truth, predicted).matchedMembers, exhaustive(weights), `Overlap graph ${bits}`);
  }
});

test('partial, duplicate-prediction, disjoint and nested occurrences retain honest membership denominators', () => {
  const truth = [occurrence('r1', ['a', 'b']), occurrence('r2', ['a', 'b', 'c'])];
  const perfect = membership(truth, truth);
  assert.equal(perfect.matchedMembers, 5, 'Nested memberships count in each distinct occurrence.');
  assert.equal(perfect.f1, 1);
  const repeatedPrediction = membership([truth[0]], [occurrence('e1', ['a', 'b']), occurrence('e2', ['a', 'b'])]);
  assert.equal(repeatedPrediction.precision, 0.5);
  assert.equal(repeatedPrediction.recall, 1);
  assert.equal(repeatedPrediction.unmatchedEstimatedIds.length, 1);
  const result = membership([occurrence('r', ['a', 'b', 'c'])], [occurrence('e', ['a', 'b', 'x']), occurrence('wrong', ['y'])]);
  assert.equal(result.precision, 0.5);
  assert.equal(result.recall, 2 / 3);
  assert.deepEqual(result.unmatchedEstimatedIds, ['wrong']);
  const disjoint = membership([occurrence('r', ['a'])], [occurrence('e', ['b'])]);
  assert.deepEqual(prf(disjoint), [0, 0, 0]);
  assert.deepEqual(disjoint.matches, []);
  assert.deepEqual(disjoint.unmatchedReferenceIds, ['r']);
});

test('membership input rejects duplicates within an occurrence, empty occurrences, duplicate IDs and oversized assignment', () => {
  for (const members of [[], ['a', 'a'], ['']]) assert.throws(() => membership([], [occurrence('e', members)]), /membership/);
  assert.throws(() => membership([], [occurrence('e', ['a']), occurrence('e', ['b'])]), /unique/);
  assert.throws(() => membership([], Array.from({ length: MAX_OCCURRENCES + 1 }, (_, i) => occurrence(String(i), ['a']))), /at most/);
});

test('alternative annotations remain separate and incompatible readings are never combined into a favorable truth', () => {
  const boundaries = evaluateBoundaries([4, 12], [{ id: 'early', boundaries: [4] }, { id: 'late', boundaries: [12] }], { ...options, tolerance: 0 });
  assert.deepEqual(boundaries.map(result => [result.referenceId, result.precision, result.recall]), [['early', 0.5, 1], ['late', 0.5, 1]]);
  const results = evaluateOccurrences([occurrence('prediction', ['a', 'b'])], [
    { id: 'first', occurrences: [occurrence('r', ['a'])] }, { id: 'second', occurrences: [occurrence('r', ['b'])] },
  ]);
  assert.deepEqual(results.map(result => [result.referenceId, result.precision, result.recall]), [['first', 0.5, 1], ['second', 0.5, 1]]);
});
