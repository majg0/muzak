import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateDiscoveredMemberships, evaluateSceneWork, parseSymbolicPair, type BenchmarkWork } from '../scripts/evaluate-patterns';
import type { ScoreNote } from '../src/score/score';

test('canonical CSV rounding preserves exact rational tuplets and negative pickups', () => {
  const parsed = parseSymbolicPair('-0.3333333333,60,60,0.1666666667,0\n0.3333333333,65,63,0.6666666667,0',
    '(-1/3 60 60 1/6 0)\n(1/3 65 63 2/3 0)', 5);
  assert.deepEqual(parsed.rational[0][0], { numerator: -1, denominator: 3 });
  assert.deepEqual(parsed.rational[1][3], { numerator: 2, denominator: 3 });
  const rounded = parseSymbolicPair('191.3333400000,60', '(574/3 60)', 2);
  assert.deepEqual(rounded.rational[0][0], { numerator: 574, denominator: 3 });
  assert.equal(rounded.roundedTimeValues, 1);
  assert.ok(rounded.maximumTimeRounding > 0.000006);
  assert.throws(() => parseSymbolicPair('0.333,60', '(1/3 60)', 2), /disagree/);
  assert.throws(() => parseSymbolicPair('0,60', '(0 60 1)', 2), /column/);
  assert.throws(() => parseSymbolicPair('0,60', '(0 (execute 60))', 2), /flat/);
});

const note = (id: string, onset: number, pitch: number, part = 'staff-0'): ScoreNote =>
  ({ id, onset, duration: 7, pitch: { millicents: pitch * 100000 }, part, velocity: 80, releaseVelocity: 64 });
function fixture(notes: ScoreNote[]): BenchmarkWork {
  const points = new Map<string, ScoreNote[]>();
  for (const note of notes) {
    const key = `${note.onset}:${note.pitch.millicents / 100000}`, group = points.get(key) ?? [];
    group.push(note); points.set(key, group);
  }
  return { work: 'original-test', pickupShiftTicks: 0, families: [], points,
    source: { csvPath: '', csvSha256: '', lispPath: '', lispSha256: '' },
    statistics: { sourceRows: notes.length, coincidentPointCollisions: notes.length - points.size, families: 0, occurrences: 0 },
    score: { ppq: 6, duration: 30, trackEnds: [30, 30], attachments: [], notes, parts: [0, 1].map(track =>
      ({ id: `staff-${track}`, name: 'Original', track, channel: track, percussion: false })) } };
}
test('automatic-candidate adequacy uses complete families and keeps oracle choice separate from rank', () => {
  const candidates = [
    { id: 'all-in-one-window', occurrences: [{ id: 'window', members: ['a', 'b', 'c', 'd'] }] },
    { id: 'two-occurrences', occurrences: [{ id: 'first', members: ['a', 'b'] }, { id: 'second', members: ['c', 'd'] }] },
  ];
  const references = [
    { id: 'small-family', annotator: 'reader-one', occurrences: [{ id: 'occ1', members: ['a', 'b'] }, { id: 'occ2', members: ['c', 'd'] }] },
    { id: 'long-span', annotator: 'reader-two', occurrences: [{ id: 'span', members: ['a', 'b', 'c', 'd'] }] },
  ];
  const result = evaluateDiscoveredMemberships(candidates, references);
  assert.equal(result.families[0].oracleBestCandidate?.rank, 2);
  assert.equal(result.families[0].oracleBestCandidate?.metrics.f1, 1);
  assert.equal(result.families[0].oracleBestByPrefix[0].bestCandidate?.metrics.f1, .5);
  assert.equal(result.families[0].oracleBestCandidate?.metrics.referenceMembers, 4, 'Discovery includes the first occurrence rather than supplying it as a query.');
  assert.equal(result.families[1].oracleBestCandidate?.rank, 1, 'Competing readings remain separate.');
  assert.match(result.interpretation, /oracle/);
});

test('occurrence assignment limits are reported without slicing candidate occurrence sets', () => {
  const tooMany = { id: 'large', occurrences: Array.from({ length: 513 }, (_, i) => ({ id: `o${i}`, members: [`p${i}`] })) };
  const small = { id: 'small', occurrences: [{ id: 'one', members: ['p0'] }] };
  const references = [{ id: 'human', annotator: 'reader', occurrences: [{ id: 'occ1', members: ['p0'] }] }];
  const result = evaluateDiscoveredMemberships([tooMany, small], references);
  assert.equal(result.candidatesScored, 1);
  assert.equal(result.unsupportedCandidates[0].rank, 1);
  assert.match(result.unsupportedCandidates[0].reason, /512-occurrence/);
  assert.equal(result.families[0].oracleBestCandidate?.rank, 2);
  const capped = evaluateDiscoveredMemberships([small], references, 0);
  assert.equal(capped.families[0].oracleBestCandidate, null);
  assert.equal(capped.candidatesScored, 0);
  assert.match(capped.unsupportedCandidates[0].reason, /budget/);
  const largeReference = evaluateDiscoveredMemberships([small], [...references, { id: 'oversized-reader', annotator: 'other', occurrences: tooMany.occurrences }]);
  assert.equal(largeReference.families[0].oracleBestCandidate?.metrics.f1, 1);
  assert.equal(largeReference.families[1].oracleBestCandidate, null);
  assert.equal(largeReference.unsupportedReferences[0].referenceId, 'oversized-reader');
  assert.equal(largeReference.families[1].oracleBestByPrefix[0].evaluatedCandidateCount, 0);
});

test('occurrence completion keeps unannotated returns in precision denominators', () => {
  const reference = { id: 'human-family', annotator: 'reader', occurrences: [
    { id: 'first', members: ['a', 'b'] }, { id: 'second', members: ['c', 'd'] },
  ] };
  const candidate = { id: 'unchanged-prototype', occurrences: reference.occurrences };
  const before = evaluateDiscoveredMemberships([candidate], [reference]).families[0].oracleBestCandidate!;
  const after = evaluateDiscoveredMemberships([{ ...candidate, occurrences: [...candidate.occurrences,
    { id: 'another-real-but-unannotated-return', members: ['e', 'f'] }] }], [reference]).families[0].oracleBestCandidate!;
  assert.equal(before.metrics.f1, 1);
  assert.equal(after.metrics.recall, 1);
  assert.equal(after.metrics.precision, 2 / 3);
  assert.equal(after.metrics.estimatedMembers, 6);
  assert.equal(after.metrics.referenceMembers, 4);
  assert.equal(after.rank, before.rank);
  assert.ok(after.metrics.f1 < before.metrics.f1, 'New returns are not dropped to improve the metric.');
});


test('scene evaluation decodes independently and compares complete theme memberships', () => {
  const work=fixture([0,2,4,12,14,16].map((tick,i)=>note('n'+i,tick,60+i%3)));
  const saved=structuredClone(work.score), result=evaluateSceneWork(work);
  assert.equal(result.exactReconstruction,true);
  assert.deepEqual(work.score,saved);
  assert.equal(result.evaluation.families.length,0);
});
