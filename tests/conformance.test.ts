import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFORMANCE_FRAMES, CONFORMANCE_SEED, CONFORMANCE_VERSION, runConformance, runConformanceAsync } from '../src/conformance';
import { ENGINE_VERSION } from '../src/types';

test('sixteen normalized recipe profiles match fixed versioned Node event fixtures', () => {
  assert.equal(CONFORMANCE_VERSION, ENGINE_VERSION, 'An engine version change requires deliberate fixture review.');
  const report = runConformance();
  assert.equal(report.seed, CONFORMANCE_SEED);
  assert.equal(report.frames, CONFORMANCE_FRAMES);
  assert.deepEqual(report.cases.map(item => item.id), ['12tet-ensemble', '12tet-additive-harmonic', '19edo-additive-harmonic', '19edo-additive-stretched', '24edo-ensemble', '24edo-additive-harmonic', '31edo-ensemble', '31edo-additive-harmonic', 'autonomous-ensemble', 'autonomous-additive', 'phrased-ensemble', 'phrased-additive', 'lyrical-12tet', 'lyrical-19edo', 'thematic-12tet', 'thematic-19edo']);
  for (const item of report.cases) {
    assert.match(item.expected, /^[0-9a-f]{8}$/, 'Expected values must be committed hashes.');
    assert.equal(item.actual, item.expected, `${item.id} event stream changed`);
    assert.equal(item.passed, true);
  }
  assert.equal(report.passed, true);
});

test('asynchronous browser verification yields between bounded batches and matches the same pinned fixtures', async () => {
  const expected = runConformance();
  let waitingForTask = false, taskTurns = 0;
  const completed = new Map<string, number[]>();
  const actual = await runConformanceAsync({ onProgress: progress => {
    assert.equal(waitingForTask, false, 'Input/paint task queue must run before the next progress batch.');
    waitingForTask = true;
    setTimeout(() => { waitingForTask = false; taskTurns++; }, 0);
    assert.equal(progress.caseCount, expected.cases.length);
    assert.equal(progress.id, expected.cases[progress.caseIndex].id);
    assert.equal(progress.framesTotal, expected.cases[progress.caseIndex].frames);
    const frames = completed.get(progress.id) ?? [];
    if (frames.length) assert.ok(progress.framesCompleted - frames.at(-1)! > 0 && progress.framesCompleted - frames.at(-1)! <= 8);
    else assert.equal(progress.framesCompleted, 0);
    frames.push(progress.framesCompleted); completed.set(progress.id, frames);
  } });
  assert.deepEqual(actual, expected);
  assert.equal(actual.passed, true);
  for (const result of actual.cases) {
    assert.equal(result.actual, result.expected, result.id);
    assert.equal(completed.get(result.id)!.at(-1), result.frames);
  }
  assert.equal(waitingForTask, false);
  assert.ok(taskTurns > actual.cases.length * 2);
});
