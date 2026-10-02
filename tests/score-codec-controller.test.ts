import test from 'node:test';
import assert from 'node:assert/strict';
import { createScoreCodecController, type CodecWorkerPort, type CodecWorkerRequest, type CodecWorkerMessage, type ScoreCodecSnapshot, type ScoreCodecResult } from '../src/score/codec-controller';
import { runScoreCodec } from '../src/score/codec-jobs';
import type { Score } from '../src/score/score';

class WorkerDouble implements CodecWorkerPort {
  messages: CodecWorkerRequest[] = [];
  terminated = false;
  onmessage: CodecWorkerPort['onmessage'] = null;
  onerror: CodecWorkerPort['onerror'] = null;
  postMessage(message: CodecWorkerRequest) { this.messages.push(structuredClone(message)); }
  terminate() { this.terminated = true; }
  send(message: CodecWorkerMessage) { this.onmessage?.({data: message}); }
}
const score: Score = {ppq: 1, duration: 100, parts: [{id: 'line', name: '', track: 0, channel: 0, percussion: false}],
  notes: [{id: 'a', part: 'line', onset: 90, duration: 10, pitch: {millicents: -12345}, velocity: 80, releaseVelocity: 64}],
  attachments: [], trackEnds: [100]};
function setup() {
  const workers: WorkerDouble[] = [], snapshots: ScoreCodecSnapshot[] = [];
  const controller = createScoreCodecController({onSnapshot: value => snapshots.push(value), workerFactory: () => { const worker = new WorkerDouble(); workers.push(worker); return worker; }});
  return {controller, workers, snapshots};
}
// An opaque marker is sufficient for controller lifetime checks; numerical
// codec contracts have independent Rust/native/Wasm tests.
const result = {decoded: score, marker: 'opaque codec result'} as unknown as ScoreCodecResult;

test('one complete source is sent once; view-independent snapshots follow codec stages', () => {
  const {controller, workers, snapshots} = setup(), revision = controller.setSource(score), worker = workers[0];
  assert.deepEqual(worker.messages, [{kind: 'source', revision, score}]);
  worker.send({kind: 'stage', revision, stage: 'decoding'});
  assert.deepEqual(controller.snapshot(), {revision, status: 'decoding'});
  worker.send({kind: 'ready', revision, result});
  assert.deepEqual(controller.snapshot(), {revision, status: 'ready', result});
  assert.equal(worker.terminated, true);
  worker.send({kind: 'stage', revision, stage: 'encoding'});
  assert.equal(controller.snapshot()!.status, 'ready');
  assert.equal(snapshots[0].status, 'encoding', 'earlier snapshots remain immutable');
  assert.equal(worker.messages.length, 1, 'snapshot reads do not request new analysis');
  controller.dispose();
});

test('source replacement terminates old work and ignores stale results or worker crashes', () => {
  const {controller, workers} = setup(), old = controller.setSource(score), first = workers[0];
  const revision = controller.setSource({...score, duration: 101});
  assert.equal(first.terminated, true);
  first.send({kind: 'ready', revision: old, result}); first.onerror?.({message: 'stale crash'});
  assert.deepEqual(controller.snapshot(), {revision, status: 'encoding'});
  workers[1].send({kind: 'error', revision, error: 'source budget'});
  assert.deepEqual(controller.snapshot(), {revision, status: 'error', error: 'source budget'});
  workers[1].send({kind: 'ready', revision, result});
  assert.equal(controller.snapshot()!.status, 'error');
  controller.dispose(); assert.throws(() => controller.setSource(score), /disposed/);
});

test('a worker initialization/runtime failure is explicit and does not become a partial successful scene', () => {
  const {controller, workers} = setup(), revision = controller.setSource(score);
  workers[0].onerror?.({message: 'Wasm unavailable'});
  assert.deepEqual(controller.snapshot(), {revision, status: 'error', error: 'Wasm unavailable'});
  assert.equal(workers[0].terminated, true); controller.dispose();
});

test('the only automatic pipeline encodes the whole score and decodes without source access', async () => {
  const scene = {opaque: 'serialized scene'}, decoded = {...score, notes: []}, comparison = {equal: false, missing: score.notes, extra: []};
  const calls: Array<{op: string; input: unknown}> = [], messages: CodecWorkerMessage[] = [];
  await runScoreCodec(score, 7, {call: async (op, input) => { calls.push({op, input}); return op === 'encodeScore' ? scene : op === 'decodeScene' ? decoded : comparison; }, emit: message => messages.push(message)});
  assert.deepEqual(calls, [{op: 'encodeScore', input: {score}}, {op: 'decodeScene', input: {scene}}, {op: 'compareScores', input: {a: score, b: decoded}}]);
  assert.deepEqual(messages.at(-1), {kind: 'ready', revision: 7, result: {scene, decoded, comparison}});
  assert.deepEqual(messages.slice(0, 3).map(message => message.kind === 'stage' ? message.stage : ''), ['encoding', 'decoding', 'verifying']);
});

test('decode failure never emits a successful comparison or a fallback literal reconstruction', async () => {
  const calls: string[] = [], messages: CodecWorkerMessage[] = [];
  await assert.rejects(runScoreCodec(score, 3, {call: async op => { calls.push(op); if (op === 'decodeScene') throw new Error('invalid scene'); return {}; }, emit: message => messages.push(message)}), /invalid scene/);
  assert.deepEqual(calls, ['encodeScore', 'decodeScene']); assert.equal(messages.some(message => message.kind === 'ready'), false);
});
