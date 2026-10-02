import test from 'node:test';
import assert from 'node:assert/strict';
import { boundaryEvidence } from '../src/score/boundary-evidence';
import { boundarySweep, evaluateMtcMelody, gateMtcLine, mtcScore, summarizeBoundaries } from '../scripts/evaluate-boundaries';

const split = { development: ['dev'], holdout: ['unseen'] };
const features = { midipitch: [60, 62, 62, 67], duration_frac: ['1/3', '1/6', '2/3', '2'],
  IOI_frac: ['1/3', '1/2', '2/3', null], phrase_end: [false, true, false, true] };
const melody = { id: 'original-test', tunefamily: 'dev', features };

test('held-out metadata gates before feature parsing; malformed prefixes and unknown families fail', () => {
  const heldout = '{"id":"hidden","tunefamily":"unseen","features":THIS IS NOT PARSEABLE JSON';
  assert.deepEqual(gateMtcLine(heldout, split), { partition: 'holdout', metadata: { id: 'hidden', tunefamily: 'unseen' } });
  assert.throws(() => gateMtcLine(heldout.replace('unseen', 'dev'), split), /JSON|Unexpected/);
  assert.throws(() => gateMtcLine(heldout.replace('unseen', 'unknown'), split), /frozen split/);
  assert.throws(() => gateMtcLine('{"id":"bad","tunefamily":,"features":{}', split), /metadata prefix/);
  assert.throws(() => gateMtcLine(heldout, { development: ['unseen'], holdout: ['unseen'] }), /overlapping/);
  const result = gateMtcLine(JSON.stringify({ ...melody, features: { ...features, onsettick: [999], lbdm_spitch: ['wrong'], lyrics: ['unused'] } }), split);
  assert.equal(result.partition, 'development');
  if (result.partition === 'development') assert.deepEqual(result.melody.features, features, 'Only the three input fields and separate label field survive loading.');
});

test('rational IOIs determine attacks, merged tied durations remain intact and final IOI is ignored', () => {
  const { score, trailingIoiIgnored } = mtcScore(features);
  assert.equal(score.ppq, 6);
  assert.deepEqual(score.notes.map(note => note.onset), [0, 2, 5, 9]);
  assert.deepEqual(score.notes.map(note => note.duration), [2, 1, 4, 12]);
  assert.equal(score.notes.length, 4, 'A two-quarter tied source duration remains one note.');
  assert.equal(score.duration, 21);
  assert.equal(trailingIoiIgnored, false);
  const trailing = mtcScore({ ...features, IOI_frac: ['1/3', '1/2', '2/3', '999'] });
  assert.deepEqual(trailing.score, score); assert.equal(trailing.trailingIoiIgnored, true);
  const protectedFeatures = { ...features, get phrase_end(): never { throw new Error('Labels cannot enter Score conversion.'); } };
  assert.deepEqual(mtcScore(protectedFeatures).score, score);
});

test('phrase-end labels map to next-attack gaps; endpoints and zero-strength threshold ties are explicit', () => {
  const result = evaluateMtcMelody(melody);
  assert.equal(result.status, 'evaluated');
  if (result.status !== 'evaluated') return;
  assert.deepEqual(result.referenceBoundaries, [2]);
  assert.deepEqual(result.rightAttackTicks, [2, 5, 9]);
  assert.equal(result.finalPhraseEndExcluded, true);
  const all = result.evaluations.find(metric => metric.method === 'all-gaps')!;
  assert.equal(all.estimated, 3); assert.equal(all.matched, 1); assert.equal(all.reference, 1);
  const evidence = boundaryEvidence(mtcScore(features).score, { parts: ['melody'] });
  evidence.gaps.forEach((gap, i) => { gap.pitch.normalized = [0, .5, .5][i]; });
  const sweep = boundarySweep(evidence).filter(item => item.method === 'pitch');
  assert.deepEqual(sweep.map(item => item.boundaries), [[2, 3], [2, 3], [2, 3], [], []]);
  const micro = summarizeBoundaries([result, result]).micro.find(metric => metric.method === 'all-gaps')!;
  assert.equal(micro.matched, 2); assert.equal(micro.estimated, 6); assert.equal(micro.reference, 2);
  assert.equal(micro.falsePositive, 4); assert.equal(micro.f1, .5);
});

test('zero IOIs, malformed rational data and overlaps are surfaced without timing repairs', () => {
  assert.throws(() => mtcScore({ ...features, IOI_frac: ['0', '1/2', '2/3', null] }), /Nonpositive IOI/);
  assert.throws(() => mtcScore({ ...features, duration_frac: ['1/0', '1/6', '2/3', '2'] }), /rational/);
  const overlap = evaluateMtcMelody({ ...melody, features: { ...features, duration_frac: ['1', '1/6', '2/3', '2'] } });
  assert.equal(overlap.status, 'unsupported');
  if (overlap.status === 'unsupported') assert.ok(overlap.issues.some(issue => issue.kind === 'overlapping-notes'));
  assert.equal(summarizeBoundaries([overlap]).evaluatedMelodies, 0);
  assert.equal(summarizeBoundaries([overlap]).unsupportedMelodies, 1);
  const one = evaluateMtcMelody({ ...melody, features: { midipitch: [60], duration_frac: ['0'], IOI_frac: [null], phrase_end: [true] } });
  assert.equal(one.status, 'evaluated');
  if (one.status === 'evaluated') assert.ok(one.evaluations.every(metric => metric.estimated === 0 && metric.reference === 0 && metric.f1 === 1));
});

test('constant rests remain an independent baseline, and first/last interior gaps are not endpoints', () => {
  const result = evaluateMtcMelody({ ...melody, features: { midipitch: [60, 60, 60], duration_frac: ['1', '1', '1'],
    IOI_frac: ['2', '2', null], phrase_end: [true, true, true] } });
  assert.equal(result.status, 'evaluated');
  if (result.status !== 'evaluated') return;
  assert.deepEqual(result.referenceBoundaries, [1, 2]);
  assert.deepEqual(result.rightAttackTicks, [2, 4]);
  assert.ok(result.evaluations.filter(metric => metric.method === 'rest').every(metric => metric.estimated === 0));
  assert.equal(result.evaluations.find(metric => metric.method === 'rest-present')?.f1, 1);
  assert.equal(result.evaluations.find(metric => metric.method === 'all-gaps')?.estimated, 2);
});
