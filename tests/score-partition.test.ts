import test from 'node:test';
import assert from 'node:assert/strict';
import { callCoreSync } from '../src/core/sync';
import type { Score } from '../src/score/score';
import { transposeScore } from '../src/score/operations';
import { inferHarmonicRegions } from '../src/score/harmonic-regions';

function score(): Score {
  return {ppq: 100, duration: 1600, parts: [{id: 'p', name: 'Test', track: 0, channel: 0, percussion: false}], trackEnds: [1600],
    attachments: [{tick: 0, track: 0, order: 0, bytes: [255, 88, 4, 4, 2, 24, 8]}],
    notes: [0, 400, 800, 1200].flatMap((onset, i) => [0, 700000, 1200000].map((pitch, j) => ({id: `${i}-${j}`, part: 'p',
      onset: onset + j * 50, duration: 400 - j * 50, pitch: {millicents: 4800000 + (i < 2 ? 0 : 200000) + pitch}, velocity: 70 + j * 10, releaseVelocity: 0}))) };
}
const partition = (source: Score, options = {}) => callCoreSync('inferWeightedPartition', {score: source, selection: {parts: ['p']}, options});

test('weighted leaves partition exact identities; tree parents retain membership union', () => {
  const source = score(), analysis = partition(source), original = structuredClone(source);
  const leaves = analysis.nodes.filter(node => !node.children.length);
  assert.deepEqual(leaves.flatMap(node => node.noteIds).sort(), source.notes.map(note => note.id).sort());
  for (const node of analysis.nodes) if (node.children.length) {
    assert.deepEqual(node.children.flatMap(index => analysis.nodes[index].noteIds).sort(), node.noteIds);
    assert(node.split!.varianceGain >= 0 && node.split!.varianceGain <= 1);
  }
  assert(analysis.nodes.length <= analysis.parameters.maxNodes);
  assert.deepEqual(source, original);
});

test('content identity is independent of IDs, order, PPQ, time translation and declared pitch translation', () => {
  const source = score(), first = partition(source).nodes[0].contentAddress;
  const changed = transposeScore(source, 123457);
  changed.ppq *= 3; changed.duration = changed.duration * 3 + 51; changed.trackEnds = changed.trackEnds.map(t => t * 3 + 51);
  changed.attachments = changed.attachments.map(event => ({...event, tick: event.tick * 3 + 51}));
  changed.notes = changed.notes.map((note, i) => ({...note, id: `replacement-${i}`, onset: note.onset * 3 + 51, duration: note.duration * 3})).reverse();
  assert.equal(partition(changed).nodes[0].contentAddress, first);
  changed.notes[0].velocity++;
  assert.notEqual(partition(changed).nodes[0].contentAddress, first);
  assert.equal(partition(changed, {content: {includeVelocity: false}}).nodes[0].contentAddress,
    partition(source, {content: {includeVelocity: false}}).nodes[0].contentAddress);
});

test('changing partition granularity changes tree identity while content identity remains fixed', () => {
  const source = score(), shallow = partition(source, {maxDepth: 0}), deep = partition(source, {minGain: 0});
  assert.equal(shallow.nodes.length, 1); assert(deep.nodes.length > 1);
  assert.equal(shallow.nodes[0].contentAddress, deep.nodes[0].contentAddress);
  assert.notEqual(shallow.nodes[0].treeAddress, deep.nodes[0].treeAddress);
});

test('meter and harmonic relation remain unknown without evidence; support changes are separate cues', () => {
  const source = score(), harmonic = inferHarmonicRegions(source, {parts: ['p']});
  const analysis = callCoreSync('inferWeightedPartition', {score: source, selection: {parts: ['p']}, harmonic});
  assert.equal(analysis.notes.find(note => note.noteId === '0-0')!.notatedAccent, 1);
  assert.equal(analysis.notes.find(note => note.noteId === '0-1')!.notatedAccent, 0);
  assert(analysis.notes.every(note => note.supportMembership === true && note.supportPitchClass === true));
  assert(analysis.nodes.some(node => node.split?.boundaryEvidence));
  source.attachments = [];
  const unknown = partition(source);
  assert(unknown.notes.every(note => note.notatedAccent === null && note.supportPitchClass === null && note.bassRelativeMillicents === null));
});

test('weights and budgets are explicit and counterexamples do not force subdivision', () => {
  const source = score();
  const quiet = partition(source, {features: {time: 0, pitch: 0, velocity: 0, duration: 0, rhythm: 0, support: 0}, gapWeight: 0, boundaryWeight: 0});
  assert.equal(quiet.nodes.length, 1);
  assert.throws(() => partition(source, {maxSplitEvaluations: 0}), /budget/);
  assert.throws(() => partition(source, {noteWeights: {velocity: -1}}), /priors/);
  for (const maxNodes of [1, 2, 3, 4, 7]) assert(partition(source, {maxNodes, minGain: 0}).nodes.length <= maxNodes);
  assert.equal(partition({...source, notes: []}).root, null);
});

test('unselected-part support cannot inject boundary bonuses into the inspected part', () => {
  const source = score();
  source.parts.push({id: 'q', name: 'Other line', track: 1, channel: 1, percussion: false});
  source.trackEnds.push(source.duration);
  source.notes.push(...source.notes.map(note => ({...structuredClone(note), id: `q-${note.id}`, part: 'q'})));
  const other = inferHarmonicRegions(source, {parts: ['q']});
  assert.ok(other.harmonicRuns.length > 1);
  const withOther = callCoreSync('inferWeightedPartition', {score: source, selection: {parts: ['p']}, harmonic: other});
  assert.deepEqual(withOther, partition(source), 'a supplied hypothesis outside the selected observation scope has no effect');
});

test('meter evidence uses event semantics and unsupported changes end previous assumptions', () => {
  const source = score(), before = partition(source).notes.map(note => note.notatedAccent);
  source.attachments[0].bytes = [255, 88, 128, 4, 4, 2, 24, 8]; // Valid nonminimal length VLQ.
  assert.deepEqual(partition(source).notes.map(note => note.notatedAccent), before);
  source.attachments.push({tick: 400, track: 0, order: 1, bytes: [255, 88, 4, 3, 8, 24, 8]});
  const observed = partition(source);
  assert.equal(observed.notes[0].notatedAccent, 1);
  assert.ok(observed.notes.filter(note => source.notes.find(item => item.id === note.noteId)!.onset >= 400).every(note => note.notatedAccent === null));
});

test('large leaf options stop safely and an admitted linear sweep evaluates all distinct cuts', () => {
  const stopped = partition(score(), {minLeafNotes: 2 ** 31});
  assert.equal(stopped.nodes.length, 1); assert.equal(stopped.splitEvaluations, 0);
  const source = score(); source.attachments = [];
  source.notes = Array.from({length: 1000}, (_, i) => ({id: `n${i}`, part: 'p', onset: i, duration: 1, pitch: {millicents: 6000000}, velocity: 80, releaseVelocity: 64}));
  const options = {maxDepth: 1, minGain: 0, gapWeight: 0, boundaryWeight: 0,
    features: {time: 1, pitch: 0, velocity: 0, duration: 0, rhythm: 0, support: 0}, noteWeights: {velocity: 0, duration: 0, rhythm: 0, support: 0}};
  const result = partition(source, options);
  assert.equal(result.splitEvaluations, 997); assert.equal(result.nodes.length, 3);
  assert.equal(result.nodes[0].split!.at, '500');
  assert.throws(() => partition(source, {...options, maxSplitEvaluations: 996}), /split-evaluations budget/);
});

test('native expression remains part of content identity only when the projection includes it', () => {
  const source = score(), expressive = structuredClone(source), note = expressive.notes[0];
  note.pitchEnvelope = [{tick: 0, pitch: {...note.pitch}}, {tick: note.duration, pitch: {millicents: note.pitch.millicents + 1537}}];
  note.gainEnvelope = [{tick: 0, gain: .3}, {tick: note.duration, gain: .8}];
  assert.notEqual(partition(expressive).nodes[0].contentAddress, partition(source).nodes[0].contentAddress);
  assert.equal(partition(expressive, {content: {includeExpression: false}}).nodes[0].contentAddress,
    partition(source, {content: {includeExpression: false}}).nodes[0].contentAddress);
});
