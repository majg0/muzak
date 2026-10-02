import test from 'node:test';
import assert from 'node:assert/strict';
import { compilePerformance, secondsToTick, tempoMap, tickToSeconds } from '../src/score/performance';
import type { Score, ScoreAttachment } from '../src/score/score';

function score(attachments: ScoreAttachment[] = []): Score {
  return { ppq: 100, duration: 800, parts: [{ id: 'p', name: 'Part', track: 0, channel: 0, percussion: false }],
    notes: [{ id: 'n', part: 'p', onset: 100, duration: 200, pitch: { millicents: 6_000_000 }, velocity: 100, releaseVelocity: 64 }],
    attachments, trackEnds: [800] };
}
const event = (tick: number, bytes: number[], order = 0): ScoreAttachment => ({ tick, bytes, order, track: 0 });

test('tempo integration and inverse preserve held-note time across changes', () => {
  const source = score([event(200, [255, 81, 3, 15, 66, 64])]);
  const map = tempoMap(source);
  assert.equal(tickToSeconds(300, 100, map), 2);
  for (const tick of [0, 73, 199, 200, 299, 800]) assert.equal(secondsToTick(tickToSeconds(tick, 100, map), 100, map), tick);
  const result = compilePerformance(source);
  assert.equal(result.notes[0].start, 0.5);
  assert.equal(result.notes[0].end, 2);
  assert.equal(result.duration, 7);
});

test('cropped audition restores preceding expression, pitch bend and sustain', () => {
  const source = score([
    event(0, [176, 11, 64]), event(50, [176, 101, 0]), event(50, [176, 100, 0], 1),
    event(50, [176, 6, 12], 2), event(60, [224, 0, 96]), event(250, [176, 64, 127]),
    event(450, [176, 64, 0]), event(350, [176, 11, 100]),
  ]);
  const result = compilePerformance(source, { fromTick: 325, toTick: 500 });
  assert.equal(result.notes.length, 1);
  assert.equal(result.notes[0].start, 0);
  assert.equal(result.notes[0].end, 0.625);
  assert.deepEqual(result.notes[0].bend, [{ seconds: 0, value: 6 }]);
  assert.deepEqual(result.notes[0].gain, [{ seconds: 0, value: 64 / 127 }, { seconds: 0.125, value: 100 / 127 }]);
});

test('same-tick pedal after note-off must not extend that note', () => {
  const source = score([event(300, [176, 64, 127], 5), event(600, [176, 64, 0])]);
  source.notes[0].source = { onOrder: 1, offOrder: 4, offStatus: 128 };
  assert.equal(compilePerformance(source).notes[0].end, 1.5);
  source.notes[0].source.offOrder = 6;
  assert.equal(compilePerformance(source).notes[0].end, 3);
});

test('part selection, empty intervals and rendering losses remain explicit', () => {
  const source = score([event(0, [176, 1, 80]), event(0, [192, 40], 1)]);
  assert.equal(compilePerformance(source, { parts: [] }).notes.length, 0);
  assert.equal(compilePerformance(source, { fromTick: 300, toTick: 300 }).notes.length, 0);
  assert(compilePerformance(source).warnings.some(warning => warning.includes('ignores controllers 1')));
  assert.throws(() => compilePerformance(source, { fromTick: 700, toTick: 500 }), /interval/);
});

test('NRPN selection and RPN null prevent unrelated data entry from changing pitch bend range', () => {
  const source = score([
    event(0, [176, 101, 0], 0), event(0, [176, 100, 0], 1), event(0, [176, 6, 12], 2),
    event(0, [224, 0, 96], 3),
    event(150, [176, 99, 1]), event(150, [176, 98, 2], 1), event(150, [176, 6, 64], 2), event(150, [176, 38, 50], 3),
    event(175, [176, 101, 127]), event(175, [176, 100, 127], 1), event(175, [176, 6, 99], 2),
    event(200, [176, 101, 0]), event(200, [176, 100, 0], 1), event(200, [176, 6, 4], 2),
  ]);
  const result = compilePerformance(source);
  assert.deepEqual(result.notes[0].bend, [{ seconds: 0.5, value: 6 }, { seconds: 1, value: 2 }]);
  assert(result.warnings.some(warning => warning.includes('6, 38, 98, 99')));
});

test('attack automation respects same-tick source order while cropped holds inherit later controls', () => {
  const source = score([event(100, [176, 11, 64], 4), event(100, [176, 11, 100], 6)]);
  source.notes[0].source = { onOrder: 5, offOrder: 8, offStatus: 128 };
  assert.deepEqual(compilePerformance(source).notes[0].gain, [
    { seconds: 0.5, value: 64 / 127 }, { seconds: 0.5, value: 100 / 127 },
  ]);
  assert.deepEqual(compilePerformance(source, { fromTick: 101 }).notes[0].gain, [{ seconds: 0, value: 100 / 127 }]);
});

test('sustain without a release ends at score boundary and selection clips it consistently', () => {
  const source = score([event(250, [176, 64, 127])]);
  assert.equal(compilePerformance(source).notes[0].end, 4);
  const cropped = compilePerformance(source, { fromTick: 400, toTick: 500 });
  assert.equal(cropped.notes[0].start, 0);
  assert.equal(cropped.notes[0].end, 0.5);
  source.parts[0].percussion = true;
  assert.equal(compilePerformance(source, { fromTick: 400, toTick: 500 }).notes.length, 0);
});
