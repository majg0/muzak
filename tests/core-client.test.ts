import test from 'node:test';
import assert from 'node:assert/strict';
import { createCoreClient, type CoreWorkerMessage, type CoreWorkerPort, type CoreWorkerRequest } from '../src/core/client';
import { RustCoreError } from '../src/core/runtime';

class WorkerDouble implements CoreWorkerPort {
  messages: CoreWorkerRequest[] = [];
  terminated = false;
  onmessage: CoreWorkerPort['onmessage'] = null;
  onerror: CoreWorkerPort['onerror'] = null;
  postMessage(message: CoreWorkerRequest): void { this.messages.push(structuredClone(message)); }
  terminate(): void { this.terminated = true; }
  send(message: CoreWorkerMessage): void { this.onmessage?.({ data: message }); }
}
function setup() {
  const workers: WorkerDouble[] = [];
  const client = createCoreClient({ workerFactory: () => { const worker = new WorkerDouble(); workers.push(worker); return worker; } });
  return { client, workers };
}

test('clients create workers lazily and route out-of-order responses by request identity', async () => {
  const { client, workers } = setup();
  assert.equal(workers.length, 0);
  const first = client.call('midiPayload', { bytes: [1] });
  const second = client.call('midiPayload', { bytes: [2] });
  assert.equal(workers.length, 1);
  const worker = workers[0], [a, b] = worker.messages;
  assert.deepEqual(a.request, { op: 'midiPayload', input: { bytes: [1] } });
  worker.send({ id: b.id, response: { op: 'midiPayload', output: [20] } });
  worker.send({ id: a.id, response: { op: 'midiPayload', output: [10] } });
  assert.deepEqual(await first, [10]); assert.deepEqual(await second, [20]);
  client.dispose();
});

test('disposing one caller cancels all its requests and leaves other callers running', async () => {
  const a = setup(), b = setup();
  const first = a.client.call('midiPayload', { bytes: [1] });
  const second = a.client.call('midiPayload', { bytes: [2] });
  const other = b.client.call('midiPayload', { bytes: [3] });
  const cancelled = [assert.rejects(first, /disposed/), assert.rejects(second, /disposed/)];
  a.client.dispose(); a.client.dispose();
  await Promise.all(cancelled);
  assert.equal(a.workers[0].terminated, true); assert.equal(b.workers[0].terminated, false);
  a.workers[0].send({ id: a.workers[0].messages[0].id, response: { op: 'midiPayload', output: [999] } });
  a.workers[0].onerror?.({ message: 'Late crash' });
  b.workers[0].send({ id: b.workers[0].messages[0].id, response: { op: 'midiPayload', output: [30] } });
  assert.deepEqual(await other, [30]);
  await assert.rejects(a.client.call('midiPayload', { bytes: [] }), /disposed/);
  assert.equal(a.workers.length, 1, 'A disposed client cannot recreate its worker.');
  b.client.dispose();
});

test('worker crashes reject pending work and stale crashed-worker messages cannot affect a replacement', async () => {
  const { client, workers } = setup();
  const first = client.call('midiPayload', { bytes: [1] });
  const second = client.call('midiPayload', { bytes: [2] });
  const rejected = [assert.rejects(first, /Wasm failed/), assert.rejects(second, /Wasm failed/)];
  workers[0].onerror?.({ message: 'Wasm failed' }); await Promise.all(rejected);
  assert.equal(workers[0].terminated, true);
  const recovered = client.call('midiPayload', { bytes: [3] }), id = workers[1].messages[0].id;
  workers[0].send({ id, response: { op: 'midiPayload', output: [999] } });
  workers[0].onerror?.({ message: 'Another old crash' });
  workers[1].send({ id, response: { op: 'midiPayload', output: [30] } });
  assert.deepEqual(await recovered, [30]); assert.equal(workers[1].terminated, false);
  client.dispose();
});

test('core errors and mismatched replies fail explicitly without corrupting other requests', async () => {
  const { client, workers } = setup();
  const invalid = client.call('midiPayload', { bytes: [] });
  const failed = assert.rejects(invalid, error => error instanceof RustCoreError && error.code === 'invalid-input' && error.message === 'Invalid MIDI.');
  workers[0].send({ id: workers[0].messages[0].id, error: { code: 'invalid-input', message: 'Invalid MIDI.' } });
  await failed;
  const mismatch = client.call('midiPayload', { bytes: [] });
  const mismatchFailure = assert.rejects(mismatch, /mismatched operation/);
  workers[0].send({ id: workers[0].messages[1].id, response: { op: 'validateScore', output: null } });
  await mismatchFailure;
  const final = client.call('midiPayload', { bytes: [] });
  workers[0].send({ id: workers[0].messages[2].id, response: { op: 'midiPayload', output: [] } });
  assert.deepEqual(await final, []); client.dispose();
});

test('worker creation and posting failures reject promptly and permit a later valid request', async () => {
  let attempts = 0;
  const worker = new WorkerDouble();
  const client = createCoreClient({ workerFactory: () => { if (++attempts === 1) throw new Error('Cannot start worker.'); return worker; } });
  await assert.rejects(client.call('midiPayload', { bytes: [] }), /Cannot start worker/);
  worker.postMessage = () => { throw new Error('Cannot serialize request.'); };
  await assert.rejects(client.call('midiPayload', { bytes: [] }), /Cannot serialize request/);
  worker.postMessage = message => worker.messages.push(message);
  const valid = client.call('midiPayload', { bytes: [] });
  worker.send({ id: worker.messages[0].id, response: { op: 'midiPayload', output: [] } });
  assert.deepEqual(await valid, []); client.dispose();
});

test('disposal during the no-worker runtime load rejects instead of executing stale work', async () => {
  const client = createCoreClient();
  const pending = client.call('midiPayload', { bytes: [0] });
  const rejected = assert.rejects(pending, /disposed/);
  client.dispose(); await rejected;
  await assert.rejects(client.call('midiPayload', { bytes: [] }), /disposed/);
});
