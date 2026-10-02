import test from 'node:test';
import assert from 'node:assert/strict';
import { midiPayload, readMidi, writeMidi, type MidiEvent, type MidiFile } from '../src/score/midi-file';
import { exportScoreMidi, importMidi } from '../src/score/midi-score';

// Original synthetic events only. This helper deliberately writes raw SMF chunks
// independently of the codec, so malformed input tests exercise its parser.
function rawFile(tracks: number[][], format = 1, division = 96): Uint8Array {
  const bytes = [77, 84, 104, 100, 0, 0, 0, 6, 0, format, tracks.length >> 8, tracks.length & 255, division >> 8, division & 255];
  for (const track of tracks) bytes.push(77, 84, 114, 107, 0, 0, track.length >> 8, track.length & 255, ...track);
  return Uint8Array.from(bytes);
}
const event = (tick: number, bytes: number[]): MidiEvent => ({ tick, bytes });
const end = (tick: number) => event(tick, [255, 47, 0]);

test('raw running status, one-byte channel messages and note-on releases decode correctly', () => {
  const input = rawFile([[0, 0xc1, 8, 0, 9, 0, 0xd1, 45, 0, 46,
    0, 0x91, 60, 80, 96, 60, 0, 0, 255, 47, 0]], 0);
  const decoded = readMidi(input);
  assert.deepEqual(decoded, { format: 0, ppq: 96, tracks: [[
    event(0, [0xc1, 8]), event(0, [0xc1, 9]), event(0, [0xd1, 45]), event(0, [0xd1, 46]),
    event(0, [0x91, 60, 80]), event(96, [0x91, 60, 0]), end(96),
  ]] });
  const imported = importMidi(input);
  assert.equal(imported.issues.length, 0);
  assert.equal(imported.score.notes[0].pitch.millicents, 6_000_000);
  assert.equal(imported.score.notes[0].duration, 96);
  assert.deepEqual(readMidi(exportScoreMidi(imported.score)), decoded);
});

test('score round trip preserves opaque metadata, controllers, note pairing, ordering and silent track tails', () => {
  const file: MidiFile = { format: 1, ppq: 960, tracks: [[
    event(0, [255, 3, 4, 84, 101, 115, 116]),
    event(0, [255, 84, 5, 255, 12, 34, 56, 78]), // Invalid SMPTE-offset contents remain opaque.
    event(0, [255, 112, 3, 0, 255, 128]), // Unknown metadata with eight-bit payload.
    event(0, [240, 3, 65, 1, 247]), event(0, [247, 2, 248, 250]),
    event(0, [0xb0, 64, 127]), event(0, [0xe0, 1, 65]),
    event(10, [0x90, 60, 93]), event(10, [0xb0, 11, 99]),
    event(20, [0x90, 60, 77]), event(30, [0x80, 60, 42]), event(40, [0x90, 60, 0]),
    event(40, [0x90, 64, 88]), event(40, [0x80, 64, 13]), // Zero-length note.
    event(50, [0x80, 72, 11]), // Unmatched release must not vanish.
    event(60, [0x90, 76, 95]), // Unclosed attack must not acquire an invented release.
    end(600),
  ], [event(0, [255, 81, 3, 7, 161, 32]), end(2000)]] };
  const imported = importMidi(writeMidi(file));
  assert.deepEqual(imported.score.notes.map(note => [note.onset, note.duration, note.velocity, note.releaseVelocity]), [
    [10, 20, 93, 42], [20, 20, 77, 0], [40, 0, 88, 13],
  ]);
  assert.equal(imported.score.parts[0].name, 'Test');
  assert.equal(imported.score.duration, 2000);
  assert.deepEqual(imported.score.trackEnds, [600, 2000]);
  assert.deepEqual(imported.issues.map(issue => issue.kind), ['overlapping-pitch', 'unmatched-note-off', 'unclosed-note']);
  assert.deepEqual(readMidi(exportScoreMidi(imported.score)), file);
  assert.deepEqual(exportScoreMidi(imported.score), exportScoreMidi(imported.score));
});

test('tracks and channels keep independent note identities; type-1 single track is retained', () => {
  const file: MidiFile = { format: 1, ppq: 48, tracks: [[
    event(0, [0x90, 60, 50]), event(0, [0x91, 60, 60]), event(0, [0x99, 60, 70]),
    event(10, [0x81, 60, 5]), event(20, [0x80, 60, 6]), event(30, [0x89, 60, 7]), end(40),
  ]] };
  const { score, issues } = importMidi(writeMidi(file));
  assert.equal(issues.length, 0);
  assert.deepEqual(score.parts.map(part => [part.channel, part.percussion]), [[0, false], [1, false], [9, true]]);
  assert.deepEqual(score.notes.map(note => note.duration), [20, 10, 30]);
  assert.deepEqual(readMidi(exportScoreMidi(score)), file);
});

test('native pitch and edited notes are authoritative; export never rounds or duplicates attacks', () => {
  const { score } = importMidi(writeMidi({ format: 0, ppq: 96, tracks: [[event(0, [0x90, 60, 80]), event(96, [0x80, 60, 10]), end(192)]] }));
  score.notes[0].pitch.millicents = 6_100_000;
  score.notes[0].onset = 24;
  score.notes[0].duration = 48;
  const decoded = readMidi(exportScoreMidi(score));
  assert.deepEqual(decoded.tracks[0], [event(24, [0x90, 61, 80]), event(72, [0x80, 61, 10]), end(192)]);
  score.notes[0].pitch.millicents++;
  assert.throws(() => exportScoreMidi(score), /exactly representable/);
});

test('new adjacent and zero-duration notes have deterministic musically valid same-tick order', () => {
  const { score } = importMidi(writeMidi({ format: 0, ppq: 96, tracks: [[event(0, [0x90, 60, 80]), event(96, [0x80, 60, 0]), end(192)]] }));
  delete score.notes[0].source;
  score.notes.push({ ...score.notes[0], id: 'next', onset: 96, duration: 0 });
  assert.deepEqual(readMidi(exportScoreMidi(score)).tracks[0].filter(item => item.tick === 96), [
    event(96, [0x80, 60, 0]), event(96, [0x90, 60, 80]), event(96, [0x80, 60, 0]),
  ]);
});

test('meta/SysEx cancel running status and cannot contain truncated or oversized lengths', () => {
  for (const interlude of [[255, 1, 0], [240, 1, 247], [247, 0]]) {
    assert.throws(() => readMidi(rawFile([[0, 0x90, 60, 90, 0, ...interlude, 0, 60, 0, 0, 255, 47, 0]])), /running status/);
  }
  assert.throws(() => readMidi(rawFile([[0, 0x90, 60]])), /Truncated/);
  assert.throws(() => readMidi(rawFile([[0, 255, 1, 5, 65]])), /Truncated/);
  assert.throws(() => readMidi(rawFile([[0, 240, 5, 65]])), /Truncated/);
  assert.throws(() => readMidi(rawFile([[128, 128, 128, 128, 0, 255, 47, 0]])), /four bytes/);
  assert.throws(() => readMidi(rawFile([[0, 255, 1, 128, 128, 128, 128, 0]])), /four bytes/);
  assert.throws(() => readMidi(rawFile([[0, 0x90, 60, 255, 0, 255, 47, 0]])), /seven-bit/);
});

test('unsupported formats, timebases and invalid chunk/event structures fail explicitly', () => {
  assert.throws(() => readMidi(rawFile([[0, 255, 47, 0]], 2)), /Type 2/);
  assert.throws(() => readMidi(rawFile([[0, 255, 47, 0]], 0, 0xe728)), /SMPTE/);
  assert.throws(() => readMidi(rawFile([[0, 255, 47, 0]], 0, 0)), /positive/);
  assert.throws(() => readMidi(rawFile([[0, 0x90, 60, 80]])), /missing.*end-of-track/);
  assert.throws(() => readMidi(rawFile([[0, 255, 47, 0, 0, 0x90, 60, 80]])), /after end-of-track/);
  assert.throws(() => readMidi(rawFile([[0, 0xf1, 0, 0, 255, 47, 0]])), /Unsupported MIDI file event/);
  assert.throws(() => readMidi(rawFile([[0, 255, 47, 0]]).subarray(0, 22)), /Truncated/);
  assert.throws(() => writeMidi({ format: 0, ppq: 96, tracks: [[event(10, [0x90, 60, 80]), end(5)]] }), /ordered/);
  assert.throws(() => writeMidi({ format: 0, ppq: 96, tracks: [[event(0, [0x90, 60, 256]), end(5)]] }), /Invalid MIDI event byte/);
  assert.throws(() => writeMidi({ format: 0, ppq: 96, tracks: [[end(0x1000_0000)]] }), /VLQ range/);
});

test('opaque event helper strips envelopes while preserving all payload bytes', () => {
  assert.deepEqual(midiPayload([255, 112, 128, 2, 255, 128]), [255, 128]);
  assert.deepEqual(midiPayload([240, 3, 65, 1, 247]), [65, 1, 247]);
  assert.deepEqual(midiPayload([0xb0, 64, 127]), [64, 127]);
  assert.throws(() => midiPayload([255, 1, 0, 7]), /trailing/);
});
