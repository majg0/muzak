import test from 'node:test';
import assert from 'node:assert/strict';
import { boundaryEvidence, type BoundaryEvidence } from '../src/score/boundary-evidence';
import { stretchScore, transposeScore } from '../src/score/operations';
import type { Score, ScoreNote } from '../src/score/score';

const note = (id: string, onset: number, duration: number, pitch: number): ScoreNote =>
  ({ id, part: 'line', onset, duration, pitch: { millicents: pitch * 100000 }, velocity: 80, releaseVelocity: 64 });
const score = (notes: ScoreNote[]): Score => {
  const duration = notes.reduce((end, note) => Math.max(end, note.onset + note.duration), 0);
  return { ppq: 12, duration, trackEnds: [duration], attachments: [], notes,
    parts: [{ id: 'line', name: 'Explicit line', track: 0, channel: 0, percussion: false }] };
};
const selection = { parts: ['line'] };
const varied = () => score([note('a', 0, 12, 60), note('b', 12, 12, 61), note('c', 36, 12, 64), note('d', 48, 12, 65)]);
const normalized = (report: BoundaryEvidence) => report.gaps.flatMap(gap => [gap.pitch.normalized, gap.ioi.normalized, gap.rest.normalized]);
const approximately = (actual: number[], expected: number[]) => {
  assert.equal(actual.length, expected.length);
  actual.forEach((value, i) => assert.ok(Math.abs(value - expected[i]) < 1e-12, `${value} != ${expected[i]}`));
};

test('refined LBDM change/proximity formula exposes independent profiles and full source witnesses', () => {
  const result = boundaryEvidence(varied(), selection);
  assert.equal(result.status, 'supported');
  assert.deepEqual(result.gaps.map(gap => gap.raw), [
    { pitchMillicents: 100000, ioiTicks: 12, restTicks: 0 },
    { pitchMillicents: 300000, ioiTicks: 24, restTicks: 12 },
    { pitchMillicents: 100000, ioiTicks: 12, restTicks: 0 },
  ]);
  assert.deepEqual(result.gaps.map(gap => gap.pitch.strength), [50000, 300000, 50000]);
  approximately(result.gaps.map(gap => gap.pitch.normalized), [1 / 6, 1, 1 / 6]);
  approximately(result.gaps.map(gap => gap.ioi.normalized), [.25, 1, .25]);
  assert.deepEqual(result.gaps.map(gap => gap.rest.normalized), [0, 1, 0]);
  assert.deepEqual(result.gaps[1].witnesses, { before: 'a', left: 'b', right: 'c', after: 'd' });
  assert.deepEqual(result.gaps.map(gap => [gap.leftOffsetTick, gap.tick]), [[12, 12], [24, 36], [48, 48]]);
  assert.equal(result.gaps[0].pitch.changeBefore, null);
  assert.equal(result.gaps[2].pitch.changeAfter, null);
  assert.ok(result.gaps.every(gap => !('confidence' in gap)), 'No combined phrase-confidence value is fabricated.');
});

test('equal interval profiles give no discontinuity, while a rest changes only its own cue', () => {
  const line = score([0, 1, 2, 3].map(i => note(`n-${i}`, i * 12, 12, 60 + i * 2)));
  const continuous = boundaryEvidence(line, selection);
  assert.ok(normalized(continuous).every(value => value === 0));
  const detached = structuredClone(line); detached.notes[1].duration = 6;
  const result = boundaryEvidence(detached, selection);
  assert.deepEqual(result.gaps.map(gap => gap.rest.normalized), [0, 1, 0]);
  assert.ok(result.gaps.every(gap => gap.ioi.normalized === 0 && gap.pitch.normalized === 0));
  const repeatedPitch = structuredClone(line);
  repeatedPitch.notes.forEach(note => { note.pitch.millicents = 6000000; });
  assert.ok(normalized(boundaryEvidence(repeatedPitch, selection)).every(value => value === 0), 'r(0,0) remains finite and zero.');
});

test('transposition and inactive-cap uniform time scaling preserve normalized cues; tempo is independent', () => {
  const line = varied();
  line.notes[0].pitchEnvelope = [{ tick: 0, pitch: { ...line.notes[0].pitch } }, { tick: 3, pitch: { millicents: 6012500 } }];
  line.notes[0].gainEnvelope = [{ tick: 0, gain: .2 }, { tick: 5, gain: .7 }];
  line.attachments = [{ tick: 0, track: 0, order: 0, bytes: [255, 81, 3, 7, 161, 32] }];
  const saved = structuredClone(line), original = boundaryEvidence(line, selection);
  approximately(normalized(boundaryEvidence(transposeScore(line, 237500), selection)), normalized(original));
  approximately(normalized(boundaryEvidence(stretchScore(line, 2, 3), selection)), normalized(original));
  const faster = structuredClone(line); faster.attachments[0].bytes = [255, 81, 3, 3, 208, 144];
  assert.deepEqual(boundaryEvidence(faster, selection), original);
  assert.deepEqual(line, saved, 'Notes, native trajectories and context remain intact.');
});

test('capping changes only declared cue inputs; time scaling needs co-scaled caps when clipping is active', () => {
  const line = score([note('a', 0, 6, 60), note('b', 12, 6, 80), note('c', 48, 6, 81), note('d', 120, 6, 82)]);
  const report = boundaryEvidence(line, selection);
  assert.deepEqual(report.parameters.caps, { pitchMillicents: 1200000, ioiQuarters: 4, restQuarters: 4 });
  assert.equal(report.gaps[0].raw.pitchMillicents, 2000000);
  assert.equal(report.gaps[0].pitch.interval, 1200000);
  assert.equal(report.gaps[0].pitch.capped, true);
  assert.equal(report.gaps[2].raw.ioiTicks, 72);
  assert.equal(report.gaps[2].ioi.interval, 4);
  assert.equal(report.gaps[2].ioi.capped, true);
  const doubled = stretchScore(line, 2, 1);
  assert.notDeepEqual(normalized(boundaryEvidence(doubled, selection)), normalized(report));
  approximately(normalized(boundaryEvidence(doubled, selection, { caps: { ioiQuarters: 8, restQuarters: 8 } })), normalized(report));
  assert.equal(line.notes[3].onset, 120, 'Source notes are never clipped to the caps.');
});

test('simultaneous attacks and overlapping tails are unsupported, including short legato and older held notes', () => {
  const held = score([note('long', 0, 25, 60), note('short', 12, 1, 62), note('later', 20, 1, 64)]);
  const report = boundaryEvidence(held, selection);
  assert.equal(report.status, 'unsupported');
  assert.deepEqual(report.gaps, []);
  assert.deepEqual(report.issues, [
    { kind: 'overlapping-notes', noteIds: ['long', 'short'] },
    { kind: 'overlapping-notes', noteIds: ['long', 'later'] },
  ]);
  const legato = score([note('a', 0, 13, 60), note('b', 12, 12, 62)]);
  assert.equal(boundaryEvidence(legato, selection).issues[0].kind, 'overlapping-notes');
  const chord = score([note('a', 0, 0, 60), note('b', 0, 0, 64)]);
  assert.equal(boundaryEvidence(chord, selection).issues[0].kind, 'simultaneous-attacks');
  const drums = varied(); drums.parts[0].percussion = true;
  assert.equal(boundaryEvidence(drums, selection).issues[0].kind, 'percussion', 'Drum keys are not interpreted as melodic pitches.');
});

test('explicit membership can select a stream from polyphony and input order supplies no inferred voice', () => {
  const original = varied(); original.notes.push(note('accompaniment', 0, 60, 40)); original.notes.reverse();
  const saved = structuredClone(original);
  const fromIds = boundaryEvidence(original, { noteIds: ['d', 'b', 'a', 'c'] });
  const fromRegister = boundaryEvidence(original, { ...selection, pitchRange: [6000000, 6500000] });
  assert.equal(fromIds.status, 'supported');
  assert.deepEqual(fromIds.noteIds, ['a', 'b', 'c', 'd']);
  assert.deepEqual(fromIds, fromRegister);
  assert.deepEqual(original, saved);
  assert.throws(() => boundaryEvidence(original, {}), /explicit/);
  assert.throws(() => boundaryEvidence(original, { noteIds: [] }), /nonempty/);
  assert.throws(() => boundaryEvidence(original, { noteIds: ['a', 'a'] }), /unique/);
  assert.throws(() => boundaryEvidence(original, { noteIds: ['missing'] }), /present/);
  assert.throws(() => boundaryEvidence(original, { parts: ['missing'] }), /Unknown/);
  assert.throws(() => boundaryEvidence(original, { pitchRange: [6500000, 6000000] }), /Invalid/);
});

test('sparse streams do not acquire invented endpoint boundaries; zero durations retain their actual rest intervals', () => {
  const empty = boundaryEvidence(score([]), selection);
  assert.equal(empty.status, 'unsupported');
  assert.deepEqual(empty.issues, [{ kind: 'empty-selection', noteIds: [] }]);
  const one = boundaryEvidence(score([note('a', 0, 0, 60)]), selection);
  assert.equal(one.status, 'supported'); assert.deepEqual(one.gaps, []);
  const two = boundaryEvidence(score([note('a', 0, 0, 60), note('b', 12, 0, 65)]), selection);
  assert.deepEqual(two.gaps[0].raw, { pitchMillicents: 500000, ioiTicks: 12, restTicks: 12 });
  assert.ok(normalized(two).every(value => value === 0));
  assert.equal(two.gaps[0].rest.changeBefore, null); assert.equal(two.gaps[0].rest.changeAfter, null);
  const zeros = boundaryEvidence(score([note('a', 0, 0, 60), note('b', 12, 0, 61), note('c', 36, 0, 62)]), selection);
  assert.deepEqual(zeros.gaps.map(gap => gap.rest.normalized), zeros.gaps.map(gap => gap.ioi.normalized));
  assert.ok(normalized(zeros).every(Number.isFinite));
});

test('invalid caps and unrepresentable raw pitch differences fail explicitly', () => {
  for (const value of [0, -1, Infinity, NaN]) assert.throws(() => boundaryEvidence(varied(), selection, { caps: { ioiQuarters: value } }), /finite/);
  const wide = score([note('a', 0, 1, 60), note('b', 12, 1, 60)]);
  wide.notes[0].pitch.millicents = -Number.MAX_SAFE_INTEGER;
  wide.notes[1].pitch.millicents = Number.MAX_SAFE_INTEGER;
  assert.throws(() => boundaryEvidence(wide, selection), /safe integer/);
});
