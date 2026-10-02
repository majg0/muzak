import test from 'node:test';
import assert from 'node:assert/strict';
import { validateScore, type Score, type ScoreNote } from '../src/score/score';
import { sliceScore, stretchScore, transposeScore } from '../src/score/operations';
import { compileComposition } from '../src/score/composition';
import { compilePerformance } from '../src/score/performance';
import { scheduleNoteCurve, ScorePlayer } from '../src/score/playback';
import { gainAt, pitchAt } from '../src/score/trajectories';
import { exportScoreMidi } from '../src/score/midi-score';

const pitch = (millicents: number) => ({ millicents });
function score(): Score {
  return { ppq: 100, duration: 400, trackEnds: [400], attachments: [],
    parts: [{ id: 'p', name: 'Independent tones', track: 0, channel: 0, percussion: false }],
    notes: [{ id: 'a', part: 'p', onset: 0, duration: 200, pitch: pitch(6_000_000), velocity: 100, releaseVelocity: 0,
      pitchEnvelope: [{ tick: 0, pitch: pitch(6_000_000) }, { tick: 200, pitch: pitch(6_400_000) }],
      gainEnvelope: [{ tick: 0, gain: 0.2 }, { tick: 100, gain: 1 }, { tick: 200, gain: 0.4 }] }] };
}

test('native trajectory validation enforces a single attack pitch, exact ordered times and bounded gains', () => {
  validateScore(score());
  const invalid: Array<(note: ScoreNote) => void> = [
    note => { note.pitchEnvelope![0].pitch.millicents++; },
    note => { note.pitchEnvelope![1].tick = 201; },
    note => { note.pitchEnvelope![1].tick = 0; },
    note => { note.pitchEnvelope![1].pitch.millicents += 0.5; },
    note => { note.gainEnvelope![1].tick = 2.5; },
    note => { note.gainEnvelope![0].tick = 1; },
    note => { note.gainEnvelope![1].gain = 1.01; },
    note => { note.gainEnvelope = []; },
  ];
  for (const mutate of invalid) { const source = score(); mutate(source.notes[0]); assert.throws(() => validateScore(source), /trajectory|trajectories/); }
});

test('crop samples the original musical position and explicitly rounds only new pitch boundaries', () => {
  const source = score(), original = structuredClone(source);
  const cropped = sliceScore(source, 50, 150, { boundary: 'clip' });
  assert.deepEqual(cropped.notes[0].pitchEnvelope, [{ tick: 0, pitch: pitch(6_100_000) }, { tick: 100, pitch: pitch(6_300_000) }]);
  assert.deepEqual(cropped.notes[0].gainEnvelope, [{ tick: 0, gain: 0.6000000000000001 }, { tick: 50, gain: 1 }, { tick: 100, gain: 0.7 }]);
  assert.equal(pitchAt(cropped.notes[0], 25), pitchAt(source.notes[0], 75));
  assert.equal(gainAt(cropped.notes[0], 25), gainAt(source.notes[0], 75));
  assert.deepEqual(source, original);
  source.notes[0].pitchEnvelope![1].pitch.millicents = 6_000_001;
  const microCrop = sliceScore(source, 50, 150, { boundary: 'clip' }).notes[0];
  assert.equal(microCrop.pitch.millicents, 6_000_000);
  assert.equal(microCrop.pitchEnvelope!.at(-1)!.pitch.millicents, 6_000_001);
  assert.equal(pitchAt(source.notes[0], 100), 6_000_000.5, 'Playback evaluation retains sub-millicent interpolation.');
});

test('transposition, exact stretch and material placement transform every knot without mutating source', () => {
  const source = score(); source.notes[0].gainEnvelope![1].tick = 51;
  const original = structuredClone(source);
  assert.deepEqual(transposeScore(transposeScore(source, 63_158), -63_158), source);
  const stretched = stretchScore(source, 1, 2);
  assert.equal(stretched.ppq, 200, 'Odd envelope knot requires finer PPQ even though onset and duration are even.');
  assert.deepEqual(stretched.notes[0].gainEnvelope, source.notes[0].gainEnvelope);
  assert.deepEqual(stretchScore(stretched, 2, 1).notes[0].gainEnvelope?.map(point => point.tick), [0, 102, 400]);
  const { notes, ...context } = source;
  const composed = compileComposition({ context, materials: [{ id: 'm', span: 200, notes }],
    placements: [{ material: 'm', onset: 100, transposeMillicents: 10_001, timeScale: { numerator: 1, denominator: 2 } }] });
  assert.equal(composed.ppq, 200);
  assert.equal(composed.notes[0].onset, 200);
  assert.equal(composed.notes[0].duration, 200);
  assert.deepEqual(composed.notes[0].gainEnvelope, notes[0].gainEnvelope);
  assert.deepEqual(composed.notes[0].pitchEnvelope?.map(point => point.pitch.millicents), [6_010_001, 6_410_001]);
  assert.deepEqual(source, original);
});

test('performance splits ramps at tempo boundaries and keeps native curves independent under channel controls and pedal', () => {
  const source = score();
  source.notes.push({ ...structuredClone(source.notes[0]), id: 'b', gainEnvelope: [{ tick: 0, gain: 1 }, { tick: 200, gain: 0 }],
    pitchEnvelope: [{ tick: 0, pitch: pitch(6_000_000) }, { tick: 200, pitch: pitch(5_800_000) }] });
  source.attachments = [
    { tick: 100, track: 0, order: 0, bytes: [255, 81, 3, 15, 66, 64] },
    { tick: 0, track: 0, order: 1, bytes: [176, 11, 64] },
    { tick: 150, track: 0, order: 2, bytes: [176, 64, 127] },
    { tick: 300, track: 0, order: 3, bytes: [176, 64, 0] },
  ];
  const compiled = compilePerformance(source, { fromTick: 50, toTick: 350 }), [a, b] = compiled.notes;
  assert.deepEqual(a.pitch, [{ seconds: 0, value: 6_100_000 }, { seconds: 0.25, value: 6_200_000 }, { seconds: 1.25, value: 6_400_000 }, { seconds: 2.25, value: 6_400_000 }]);
  assert.deepEqual(b.pitch.map(point => point.value), [5_950_000, 5_900_000, 5_800_000, 5_800_000]);
  assert.deepEqual(b.noteGain.map(point => point.value), [0.75, 0.5, 0, 0]);
  assert.deepEqual(a.gain, [{ seconds: 0, value: 64 / 127 }]);
  assert.deepEqual(b.gain, a.gain);
  assert.equal(a.end, 2.25);
  const held = compilePerformance(source, { fromTick: 250, toTick: 350 }).notes[0];
  assert.deepEqual(held.pitch.map(point => point.value), [6_400_000, 6_400_000]);
  assert.deepEqual(held.noteGain.map(point => point.value), [0.4, 0.4]);
});

test('late scheduling samples current ramp phase before scheduling remaining native gain and logarithmic pitch', () => {
  const calls: Array<[string, number, number]> = [];
  const parameter = { setValueAtTime: (v: number, t: number) => calls.push(['set', v, t]),
    linearRampToValueAtTime: (v: number, t: number) => calls.push(['linear', v, t]),
    exponentialRampToValueAtTime: (v: number, t: number) => calls.push(['exp', v, t]) } as unknown as AudioParam;
  const points = [{ seconds: 0, value: 0 }, { seconds: 2, value: 1 }, { seconds: 4, value: 0 }];
  scheduleNoteCurve(parameter, points, 10, 13);
  assert.deepEqual(calls, [['set', 0.5, 13], ['linear', 0, 14]]);
  calls.length = 0;
  scheduleNoteCurve(parameter, points, 10, 11, value => 440 * 2 ** value, true);
  assert.deepEqual(calls, [['set', 440 * Math.sqrt(2), 11], ['exp', 880, 12], ['exp', 440, 14]]);
});

test('polyphonic audition creates independent curve nodes and disconnects both voices on disposal', async () => {
  class Parameter {
    value = 0;
    events: Array<[string, number, number]> = [];
    setValueAtTime(value: number, time: number) { this.events.push(['set', value, time]); }
    linearRampToValueAtTime(value: number, time: number) { this.events.push(['linear', value, time]); }
    exponentialRampToValueAtTime(value: number, time: number) { this.events.push(['exp', value, time]); }
  }
  class Node {
    disconnected = false;
    gain = new Parameter(); pan = new Parameter(); frequency = new Parameter(); detune = new Parameter();
    threshold = new Parameter(); knee = new Parameter(); ratio = new Parameter();
    onended?: () => void;
    connect(_node: unknown) {}
    disconnect() { this.disconnected = true; }
    start(_time: number) {}
    stop(_time?: number) { if (_time === undefined) this.onended?.(); }
  }
  const gains: Node[] = [], voices: Node[] = [];
  class Context {
    currentTime = 0; destination = new Node();
    createGain() { const node = new Node(); gains.push(node); return node; }
    createDynamicsCompressor() { return new Node(); }
    createStereoPanner() { return new Node(); }
    createOscillator() { const node = new Node(); voices.push(node); return node; }
    async resume() {}
    async close() {}
  }
  const prior = globalThis.AudioContext;
  globalThis.AudioContext = Context as unknown as typeof AudioContext;
  const player = new ScorePlayer();
  try {
    const source = score();
    source.notes.push({ ...structuredClone(source.notes[0]), id: 'b', gainEnvelope: [{ tick: 0, gain: 1 }, { tick: 200, gain: 0 }],
      pitchEnvelope: [{ tick: 0, pitch: pitch(6_000_000) }, { tick: 200, pitch: pitch(5_800_000) }] });
    await player.play(source);
    assert.equal(voices.length, 2);
    assert.deepEqual(gains[2].gain.events.map(event => event.slice(0, 2)), [['set', 0.2], ['linear', 1], ['linear', 0.4]]);
    assert.deepEqual(gains[5].gain.events.map(event => event.slice(0, 2)), [['set', 1], ['linear', 0]]);
    assert(voices[0].frequency.events.at(-1)![1] > voices[0].frequency.events[0][1]);
    assert(voices[1].frequency.events.at(-1)![1] < voices[1].frequency.events[0][1]);
  } finally {
    player.dispose(); globalThis.AudioContext = prior;
  }
  assert(voices.every(voice => voice.disconnected));
  assert(gains.slice(1).every(node => node.disconnected), 'Every voice-owned gain node is released.');
});

test('independent equal pitches remain separate and MIDI refuses native curve loss', () => {
  const native = score();
  native.notes[0].pitchEnvelope = undefined;
  native.notes.push({ ...structuredClone(native.notes[0]), id: 'b', onset: 100,
    gainEnvelope: [{ tick: 0, gain: 0 }, { tick: 200, gain: 1 }] });
  const { notes, ...context } = native;
  const composed = compileComposition({ context,
    materials: [{ id: 'm', span: native.duration, notes }], placements: [{ material: 'm', onset: 0 }] });
  assert.equal(composed.notes.length, 2);
  assert.deepEqual(composed.notes.map(note => [note.onset, note.duration]), [[0, 200], [100, 200]]);
  assert.throws(() => exportScoreMidi(composed), /per-note gain trajectories/);
  assert.throws(() => exportScoreMidi(score()), /pitch glides/);
});
