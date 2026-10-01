import test from 'node:test';
import assert from 'node:assert/strict';
import { exportMidi } from '../src/midi';
import { encodeWav } from '../src/audio';
import { PPQ, type Frame, type NoteEvent } from '../src/types';
import { midiToPitch } from '../src/pitch';
import { DEFAULT_SOUND } from '../src/spectrum';

const note = (tick: number, duration: number, part: NoteEvent['part'] = 'harmony', pitch = 60): NoteEvent => ({ id: `${tick}/${part}`, tick, duration, part, ...(part === 'percussion' ? { midiNote: pitch } : { absolutePitch: midiToPitch(pitch) }), voice: 0, velocity: 0.8 });
const frame = (tick: number, tempo: number, notes: NoteEvent[] = []): Frame => ({ tick, duration: 960, parameters: { tempo }, sound: DEFAULT_SOUND, notes } as Frame);

function readMidi(data: Uint8Array) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const text = (offset: number, length: number) => new TextDecoder().decode(data.slice(offset, offset + length));
  assert.equal(text(0, 4), 'MThd'); assert.equal(view.getUint32(4), 6);
  const tracks: Array<Array<{ tick: number; status: number; type?: number; data: number[] }>> = [];
  let offset = 14;
  for (let trackIndex = 0; trackIndex < view.getUint16(10); trackIndex++) {
    assert.equal(text(offset, 4), 'MTrk'); const end = offset + 8 + view.getUint32(offset + 4); offset += 8;
    const events = []; let tick = 0;
    const variable = () => { let value = 0; let byte: number; do { byte = data[offset++]; value = value * 128 + (byte & 127); } while (byte & 128); return value; };
    while (offset < end) {
      tick += variable(); const status = data[offset++];
      if (status === 255) { const type = data[offset++]; const length = variable(); events.push({ tick, status, type, data: Array.from(data.slice(offset, offset + length)) }); offset += length; }
      else { const length = (status & 0xf0) === 0xc0 ? 1 : 2; events.push({ tick, status, data: Array.from(data.slice(offset, offset + length)) }); offset += length; }
    }
    assert.equal(offset, end); assert.equal(events.at(-1)?.type, 47); tracks.push(events);
  }
  assert.equal(offset, data.length);
  return { format: view.getUint16(8), ppq: view.getUint16(12), tracks };
}

test('MIDI has correct type, PPQ, independent voices, tempo map and drum channel', () => {
  const result = readMidi(exportMidi([frame(0, 120, [note(0, 960), note(0, 240, 'percussion', 42)]), frame(960, 60, [note(960, 960, 'bass', 36)])]));
  assert.equal(result.format, 1); assert.equal(result.ppq, PPQ); assert.equal(result.tracks.length, 8);
  assert.deepEqual(result.tracks[0].filter(event => event.type === 81).map(event => [event.tick, event.data]), [[0, [7, 161, 32]], [960, [15, 66, 64]]]);
  assert.ok(result.tracks[7].some(event => event.status === 0x99 && event.data[0] === 42));
  assert.ok(result.tracks[5].some(event => event.status === 0x94 && event.data[0] === 36));
  assert.ok(result.tracks[1].some(event => event.status === 0xc0 && event.data[0] === 4));
});

test('selected interval clips notes at both boundaries and inherits active tempo', () => {
  const result = readMidi(exportMidi([frame(0, 100, [note(100, 1300)]), frame(960, 80, [note(1500, 240, 'bass', 38)])], 480, 1200));
  const notes = result.tracks[1].filter(event => event.status === 0x90 || event.status === 0x80);
  assert.deepEqual(notes.map(event => [event.tick, event.status, event.data[0]]), [[0, 0x90, 60], [720, 0x80, 60]]);
  assert.deepEqual(result.tracks[0].filter(event => event.type === 81).map(event => event.tick), [0, 480]);
  assert.ok(!result.tracks[5].some(event => (event.status & 0xf0) === 0x90));
  assert.ok(result.tracks.every(track => track.at(-1)?.tick === 720));
});

test('note-offs precede repeated note-ons at the same tick and exports are byte-identical', () => {
  const frames = [frame(0, 84, [note(0, 960)]), frame(960, 84, [note(960, 960)])];
  const bytes = exportMidi(frames);
  assert.deepEqual(exportMidi(frames), bytes);
  const boundary = readMidi(bytes).tracks[1].filter(event => event.tick === 960);
  assert.deepEqual(boundary.map(event => event.status), [0x80, 0x90]);
});

test('empty history produces a valid silent MIDI; invalid intervals reject', () => {
  assert.equal(readMidi(exportMidi([])).tracks.length, 8);
  assert.throws(() => exportMidi([], -1), RangeError);
  assert.throws(() => exportMidi([], 100, 50), RangeError);
});

test('overlapping common tones merge so a late note-off cannot cut off the next note', () => {
  const tracks = readMidi(exportMidi([frame(0, 84, [note(0, 990)]), frame(960, 84, [note(960, 990)])])).tracks;
  assert.deepEqual(tracks[1].filter(event => event.status === 0x90 || event.status === 0x80).map(event => [event.tick, event.status]), [[0, 0x90], [1950, 0x80]]);
});

test('MIDI rejects 19-EDO and fractional absolute pitches instead of silently rounding', () => {
  const alternative = { ...frame(0, 84, [note(0, 960)]), sound: { ...DEFAULT_SOUND, tuning: '19edo' as const } };
  assert.throws(() => exportMidi([alternative]), /12-TET only/);
  const fractional = frame(0, 84, [{ ...note(0, 960, 'harmony', 60.25), midiNote: 60 }]);
  assert.throws(() => exportMidi([fractional]), /fractional pitches/);
});

test('MIDI refuses declared pitch glides even when both endpoints are integer MIDI notes', () => {
  const gliding = { ...note(0, 960), endPitch: midiToPitch(62), glideTicks: 480 };
  assert.throws(() => exportMidi([frame(0, 84, [gliding])]), /pitch glides/);
});

test('meter, section markers and instrument program changes follow the declared form', () => {
  const a = { ...frame(0, 90, [{ ...note(0, 990), timbre: 'keys' as const }]),
    form: { meter: { numerator: 3, denominator: 4 }, sectionIndex: 0, sectionStartTick: 0, sectionName: 'Opening' } as Frame['form'] };
  const b = { ...frame(1440, 90, [{ ...note(1440, 960), timbre: 'reed' as const }]),
    form: { meter: { numerator: 7, denominator: 8 }, sectionIndex: 1, sectionStartTick: 1440, sectionName: 'Searching' } as Frame['form'] };
  const parsed = readMidi(exportMidi([a, b]));
  assert.deepEqual(parsed.tracks[0].filter(event => event.type === 88).map(event => [event.tick, event.data]), [[0, [3, 2, 24, 8]], [1440, [7, 3, 12, 8]]]);
  assert.deepEqual(parsed.tracks[0].filter(event => event.type === 6).map(event => [event.tick, new TextDecoder().decode(new Uint8Array(event.data))]), [[0, '1. Opening'], [1440, '2. Searching']]);
  assert.ok(parsed.tracks[1].some(event => event.tick === 1440 && event.status === 0xc0 && event.data[0] === 71));
  const sliced = readMidi(exportMidi([a, b], 1600, 2300));
  assert.deepEqual(sliced.tracks[0].find(event => event.type === 88)?.data, [7, 3, 12, 8]);
  assert.ok(sliced.tracks[1].some(event => event.tick === 0 && event.status === 0xc0 && event.data[0] === 71));
});

test('solo and counter voices receive independent MIDI tracks and channels when present', () => {
  const theme = { ...note(0, 960, 'melody', 72), voice: 5 };
  const solo = { ...note(0, 960, 'melody', 80), voice: 6, timbre: 'reed' as const };
  const counter = { ...note(0, 960, 'melody', 67), voice: 7, timbre: 'glass' as const };
  const result = readMidi(exportMidi([frame(0, 90, [theme, solo, counter, note(0, 120, 'percussion', 42)])]));
  assert.equal(result.tracks.length, 10);
  assert.ok(result.tracks[6].some(event => event.status === 0x95 && event.data[0] === 72));
  assert.ok(result.tracks[7].some(event => event.status === 0x96 && event.data[0] === 80));
  assert.ok(result.tracks[8].some(event => event.status === 0x97 && event.data[0] === 67));
  assert.ok(result.tracks[9].some(event => event.status === 0x99 && event.data[0] === 42));
});

test('WAV encoder interleaves stereo and clips to valid signed PCM', () => {
  const buffer = { numberOfChannels: 2, sampleRate: 44100, length: 3,
    getChannelData: (channel: number) => channel ? new Float32Array([-1, 0.5, 2]) : new Float32Array([1, -0.5, -2]),
  } as AudioBuffer;
  const bytes = encodeWav(buffer); const view = new DataView(bytes.buffer);
  assert.equal(new TextDecoder().decode(bytes.slice(0, 4)), 'RIFF'); assert.equal(bytes.length, 56);
  assert.equal(view.getUint32(24, true), 44100); assert.equal(view.getUint16(22, true), 2);
  assert.deepEqual(Array.from({ length: 6 }, (_, i) => view.getInt16(44 + i * 2, true)), [32767, -32768, -16384, 16384, -32768, 32767]);
});

test('expanded orchestration retains separate channels and flute, brass and lead programs', () => {
  const extra = [10, 11, 12, 13, 14].map((voice, index) => ({ ...note(0, 480, index === 1 ? 'melody' : 'harmony', 60 + index), voice,
    timbre: (['strings', 'flute', 'brass', 'strings', 'lead'] as const)[index] }));
  const result = readMidi(exportMidi([frame(0, 96, extra)]));
  for (const [index, voice] of [10, 11, 12, 13, 14].entries()) {
    const track = result.tracks.find(events => events.some(event => event.status === (0x90 | voice)));
    assert.ok(track, `voice ${voice} has an independent track`);
    assert.ok(track.some(event => event.status === (0xc0 | voice) && event.data[0] === [48, 73, 61, 48, 80][index]));
    assert.equal(track.filter(event => (event.status & 0xf0) === 0x90).length, 1);
  }
});

test('a later scoped player exit ends an already committed MIDI hold without cutting the lead', () => {
  const pad = { ...note(0, 3840, 'harmony', 60), voice: 10, timbre: 'strings' as const };
  const lead = { ...note(0, 3840, 'melody', 72), voice: 5 };
  const second = { ...frame(960, 96), phrase: { rests: [{ startTick: 960, endTick: 1920, scope: 'ensemble', voices: [10], reason: 'Solo entry' }] } } as Frame;
  const result = readMidi(exportMidi([frame(0, 96, [pad, lead]), second]));
  const padTrack = result.tracks.find(track => track.some(event => event.status === 0x9a))!;
  assert.equal(padTrack.find(event => event.status === 0x8a)?.tick, 960);
  assert.equal(result.tracks[6].find(event => event.status === 0x85)?.tick, 3840);
});

test('an independently phrased answer has its own editable MIDI channel even without solo or counter tracks', () => {
  const layer = { ...note(360, 1200, 'melody', 67), voice: 8, timbre: 'glass' as const };
  const result = readMidi(exportMidi([frame(0, 90, [layer, { ...note(0, 960, 'melody', 72), voice: 5 }])]));
  assert.equal(result.tracks.length, 9);
  assert.ok(result.tracks[7].some(event => event.status === 0x98 && event.data[0] === 67));
  assert.ok(result.tracks[7].some(event => event.status === 0x88 && event.tick === 1560));
  assert.ok(result.tracks[6].some(event => event.status === 0x95 && event.data[0] === 72));
});

test('ensemble MIDI bass replaces held pitches and preserves repeated attacks, including sliced export', () => {
  const bass = (tick: number, duration: number, pitch: number) => ({ ...note(tick, duration, 'bass', pitch), voice: 4 });
  const frames = [frame(0, 120, [bass(0, 2880, 36)]), frame(960, 120, [bass(960, 1920, 41), bass(1440, 360, 41)])];
  const snapshot = structuredClone(frames);
  const events = (bytes: Uint8Array) => readMidi(bytes).tracks[5].filter(event => event.status === 0x94 || event.status === 0x84)
    .map(event => [event.tick, event.status, event.data[0]]);
  assert.deepEqual(events(exportMidi(frames)), [[0, 0x94, 36], [960, 0x84, 36], [960, 0x94, 41], [1440, 0x84, 41], [1440, 0x94, 41], [1800, 0x84, 41]]);
  assert.deepEqual(events(exportMidi(frames, 1200, 1700)), [[0, 0x94, 41], [240, 0x84, 41], [240, 0x94, 41], [500, 0x84, 41]], 'A superseded bass must not reappear when exporting from the middle of its original hold.');
  assert.deepEqual(frames, snapshot, 'Realization does not mutate stored deterministic events.');
  const additive = frames.map(current => ({ ...current, sound: { ...current.sound, instrument: 'additive' as const } }));
  assert.deepEqual(events(exportMidi(additive)), [[0, 0x94, 36], [960, 0x94, 41], [2880, 0x84, 36], [2880, 0x84, 41]], 'Additive overlap and common-pitch merging are unchanged.');
});

test('the explicit lyrical color exports a string-ensemble program without changing note pitches', () => {
  const melody = { ...note(0, 1920, 'melody', 72), voice: 5, timbre: 'strings' as const, articulation: 'sustained' as const };
  const events = readMidi(exportMidi([frame(0, 84, [melody])])).tracks[6];
  assert.ok(events.some(event => event.status === 0xc5 && event.data[0] === 48));
  assert.deepEqual(events.filter(event => event.status === 0x95 || event.status === 0x85).map(event => [event.tick, event.data[0]]), [[0, 72], [1920, 72]]);
});
