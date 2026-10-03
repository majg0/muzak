import test from 'node:test';
import assert from 'node:assert/strict';
import { createScoreCodecController, type CodecWorkerPort, type CodecWorkerRequest, type CodecWorkerMessage, type ScoreCodecSnapshot, type ScoreCodecResult } from '../src/score/codec-controller';
import { runScoreCodec, runSceneEdit, runAuthoredScene } from '../src/score/codec-jobs';
import type { Score } from '../src/score/score';
import type { MusicalScene } from '../src/core/generated/MusicalScene';

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
const result = {source: score, decoded: score, scene: {marker: 'original program'}} as unknown as ScoreCodecResult;

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
  assert.deepEqual(messages.at(-1), {kind: 'ready', revision: 7, result: {source: score, scene, decoded, comparison}});
  assert.deepEqual(messages.slice(0, 3).map(message => message.kind === 'stage' ? message.stage : ''), ['encoding', 'decoding', 'verifying']);
});

test('program edits retain the returned scene and compare against original observations without encoding', async () => {
  const scene = {marker: 'retained dependency'}, changed = {marker: 'same dependency, changed palette'}, decoded = {...score, notes: []};
  const comparison = {equal: false, missing: score.notes, extra: []};
  const calls: Array<{op: string; input: unknown}> = [], messages: CodecWorkerMessage[] = [];
  const edit = {op: 'changeSceneHarmony', input: {windowId: 'palette', rootMillicents: 100000}} as const;
  await runSceneEdit(score, scene as unknown as MusicalScene, edit, 8, {
    call: async (op, input) => { calls.push({op, input}); assert.notEqual(op, 'encodeScore'); return op === edit.op ? changed : op === 'decodeScene' ? decoded : comparison; },
    emit: message => messages.push(message),
  });
  assert.deepEqual(calls, [{op: edit.op, input: {...edit.input, scene}}, {op: 'decodeScene', input: {scene: changed}}, {op: 'compareScores', input: {a: score, b: decoded}}]);
  assert.deepEqual(messages.at(-1), {kind: 'ready', revision: 8, result: {source: score, scene: changed, decoded, comparison}});
});

test('authored program establishes its original realization without running inference', async () => {
  const calls: string[] = [], messages: CodecWorkerMessage[] = [];
  const scene = {marker: 'authored bindings'} as unknown as MusicalScene, comparison = {equal: true};
  await runAuthoredScene(scene, 3, {call: async op => { calls.push(op); return op === 'decodeScene' ? score : comparison; }, emit: message => messages.push(message)});
  assert.deepEqual(calls, ['decodeScene', 'compareScores']);
  assert.deepEqual(messages.at(-1), {kind: 'ready', revision: 3, result: {source: score, scene, decoded: score, comparison}});
});

test('sequential edits use the latest program; failed edits retain it and source replacement cancels pending work', async () => {
  const {controller, workers} = setup(), original = structuredClone(score);
  const revision = controller.setSource(original);
  original.notes[0].pitch.millicents = 999; // Caller mutation cannot change worker observations.
  assert.deepEqual(workers[0].messages[0], {kind: 'source', revision, score});
  workers[0].send({kind: 'ready', revision, result});
  const edit = {op: 'transposeScene', input: {scope: 'material', target: 'shared', millicents: 100000}} as const;
  const first = controller.edit(edit), firstRequest = workers[1].messages[0];
  assert.equal(firstRequest.kind, 'edit');
  if (firstRequest.kind !== 'edit') throw new Error('Expected edit');
  assert.deepEqual(firstRequest.scene, result.scene); assert.deepEqual(firstRequest.score, score);
  const changed = {...result, scene: {marker: 'edited retained dependency'} as unknown as MusicalScene};
  workers[1].send({kind: 'ready', revision: firstRequest.revision, result: changed}); await first;
  const second = controller.edit(edit), secondRequest = workers[2].messages[0];
  assert.equal(secondRequest.kind, 'edit');
  if (secondRequest.kind !== 'edit') throw new Error('Expected edit');
  assert.deepEqual(secondRequest.scene, changed.scene); assert.deepEqual(secondRequest.score, score);
  workers[2].send({kind: 'error', revision: secondRequest.revision, error: 'Off lattice'});
  await assert.rejects(second, /Off lattice/);
  const retry = controller.edit(edit), retryRequest = workers[3].messages[0];
  assert.equal(retryRequest.kind, 'edit');
  if (retryRequest.kind !== 'edit') throw new Error('Expected edit');
  assert.deepEqual(retryRequest.scene, changed.scene);
  const cancelled = assert.rejects(retry, /score changed/);
  controller.setSource({...score, duration: 101}); await cancelled;
  assert.equal(workers[3].terminated, true);
  workers[3].send({kind: 'ready', revision: retryRequest.revision, result: changed});
  assert.equal(controller.snapshot()?.status, 'encoding'); controller.dispose();
});

test('loading an authored scene sends only that program and retains it for later edits', async () => {
  const {controller, workers} = setup(), revision = controller.setProgram(result.scene);
  assert.deepEqual(workers[0].messages, [{kind: 'program', revision, scene: result.scene}]);
  workers[0].send({kind: 'ready', revision, result});
  const failed = controller.setProgram({marker: 'invalid program'} as unknown as MusicalScene);
  workers[1].send({kind: 'error', revision: failed, error: 'Invalid authored binding'});
  const editing = controller.edit({op: 'changeSceneHarmony', input: {windowId: 'palette', rootMillicents: 200000}});
  const request = workers[2].messages[0]; assert.equal(request.kind, 'edit');
  if (request.kind !== 'edit') throw new Error('Expected edit');
  assert.deepEqual(request.score, score); assert.deepEqual(request.scene, result.scene);
  workers[2].send({kind: 'ready', revision: request.revision, result}); await editing; controller.dispose();
});

test('decode failure never emits a successful comparison or a fallback literal reconstruction', async () => {
  const calls: string[] = [], messages: CodecWorkerMessage[] = [];
  await assert.rejects(runScoreCodec(score, 3, {call: async op => { calls.push(op); if (op === 'decodeScene') throw new Error('invalid scene'); return {}; }, emit: message => messages.push(message)}), /invalid scene/);
  assert.deepEqual(calls, ['encodeScore', 'decodeScene']); assert.equal(messages.some(message => message.kind === 'ready'), false);
});
