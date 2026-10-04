import test from 'node:test';
import assert from 'node:assert/strict';
import { createLiveUpdate } from '../src/labs/shared/live-update';

function deferred() {
  let resolve!: () => void, reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
// Let the completed worker stage, its continuation and queue cleanup settle.
async function settle() { for (let i = 0; i < 5; i++) await Promise.resolve(); }

test('live edits run one pipeline and replace queued work with the newest revision', async () => {
  const stages = [deferred(), deferred(), deferred()];
  const started: number[] = [], compiled: number[] = [], committed: number[] = [];
  let active = 0, maximumActive = 0;
  const live = createLiveUpdate<number>({
    async run(input, isCurrent) {
      active++; maximumActive = Math.max(maximumActive, active); started.push(input);
      try {
        await stages[input].promise;
        if (!isCurrent()) return;
        compiled.push(input);
        await Promise.resolve();
        if (isCurrent()) committed.push(input);
      } finally { active--; }
    },
    onError: error => { throw error; },
  });
  live.request(0); live.request(1); live.request(2);
  assert.deepEqual(started, [0]);
  stages[0].resolve(); await settle();
  assert.deepEqual(started, [0, 2]);
  assert.deepEqual(compiled, []);
  stages[2].resolve(); await settle();
  assert.deepEqual(compiled, [2]); assert.deepEqual(committed, [2]);
  assert.equal(maximumActive, 1); live.dispose();
});

test('typing delay resets on each edit and a running pipeline cannot bypass it', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const first = deferred(), started: number[] = [];
  const live = createLiveUpdate<number>({
    async run(input) { started.push(input); if (input === 0) await first.promise; },
    onError: error => { throw error; },
  });
  live.request(0);
  live.request(1, 100); context.mock.timers.tick(80);
  live.request(2, 100); first.resolve(); await settle();
  context.mock.timers.tick(99); assert.deepEqual(started, [0]);
  context.mock.timers.tick(1); await settle(); assert.deepEqual(started, [0, 2]);
  live.dispose();
});

test('a debounce that expires during worker execution starts only after that execution finishes', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const first = deferred(), started: number[] = [];
  const live = createLiveUpdate<number>({
    async run(input) { started.push(input); if (input === 0) await first.promise; },
    onError: error => { throw error; },
  });
  live.request(0); live.request(1, 100); context.mock.timers.tick(100);
  assert.deepEqual(started, [0]); first.resolve(); await settle();
  assert.deepEqual(started, [0, 1]); live.dispose();
});

test('invalidating a draft removes pending edits and prevents stale worker results from committing', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const first = deferred(), started: number[] = [], committed: number[] = [];
  const live = createLiveUpdate<number>({
    async run(input, isCurrent) { started.push(input); await first.promise; if (isCurrent()) committed.push(input); },
    onError: error => { throw error; },
  });
  live.request(0); live.request(1, 100); live.invalidate();
  context.mock.timers.tick(100); first.resolve(); await settle();
  assert.deepEqual(started, [0]); assert.deepEqual(committed, []);
  live.request(2); await settle(); assert.deepEqual(committed, [2]); live.dispose();
});

test('disposal cancels delayed edits, invalidates running work, and ignores later requests', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const first = deferred(), started: number[] = [], errors: unknown[] = [];
  let current: (() => boolean) | undefined;
  const live = createLiveUpdate<number>({
    async run(input, isCurrent) { started.push(input); current = isCurrent; await first.promise; },
    onError: error => { errors.push(error); },
  });
  live.request(0); assert.equal(current?.(), true);
  live.request(1, 100); live.dispose(); live.dispose(); live.request(2);
  assert.equal(current?.(), false);
  context.mock.timers.tick(100); first.reject(new Error('Disposed worker')); await settle();
  assert.deepEqual(started, [0]); assert.deepEqual(errors, []);
});

test('stale errors are ignored, current errors are reported, and later work can still run', async () => {
  const first = deferred(), currentFailure = new Error('Current invalid input');
  const errors: unknown[] = [], committed: number[] = [];
  const live = createLiveUpdate<number>({
    async run(input) {
      if (input === 0) await first.promise;
      else if (input === 1) throw currentFailure;
      else committed.push(input);
    },
    onError: error => { errors.push(error); },
  });
  live.request(0); live.request(1); first.reject(new Error('Obsolete input')); await settle();
  assert.deepEqual(errors, [currentFailure]);
  live.request(2); await settle(); assert.deepEqual(committed, [2]); live.dispose();
});
