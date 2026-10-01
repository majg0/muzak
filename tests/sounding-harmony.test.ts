import test from 'node:test';
import assert from 'node:assert/strict';
import { SoundingHarmony, SoundingScore } from '../src/engine/sounding-harmony';
import { midiToPitch } from '../src/pitch';
import type { NoteEvent } from '../src/types';
import { notePitchAt } from '../src/note-expression';

const note = (id: string, tick: number, pitch: number, duration: number): NoteEvent => ({ id, tick, duration,
  part: 'harmony', voice: 0, velocity: .5, absolutePitch: midiToPitch(pitch) });
const fallback = { voices: [midiToPitch(71)], bass: midiToPitch(40) };

test('melodic context follows held pitches and actual new attacks rather than unplayed planner targets', () => {
  const bed = new SoundingHarmony();
  bed.commit([note('held', 0, 60, 1920)], [], 480);
  const at = bed.at([note('enter', 720, 64, 240)], [], fallback);
  assert.deepEqual(at(600).voices, [midiToPitch(60)]);
  assert.deepEqual(at(720).voices, [midiToPitch(64)]);
  assert.deepEqual(at(970).voices, fallback.voices, 'A superseded held note must not reappear.');
});

test('harmonic context interpolates fixed-point glides and respects shared rests across frame boundaries', () => {
  const bed = new SoundingHarmony();
  const glide = { ...note('glide', 0, 60, 1920), endPitch: midiToPitch(61), glideTicks: 960 };
  bed.commit([glide], [], 480);
  assert.equal(bed.at([], [], fallback)(600).voices[0].millicents, 6062500);
  const rest = { startTick: 700, endTick: 800, scope: 'ensemble' as const, reason: 'Breath' };
  assert.deepEqual(bed.at([], [rest], fallback)(900).voices, fallback.voices);
  bed.commit([], [rest], 960);
  assert.deepEqual(bed.at([], [], fallback)(1000).voices, fallback.voices);
});

test('shared sounding evidence retains independent foreground and orchestral tails through partial rests', () => {
  const score = new SoundingScore();
  const lead = { ...note('lead', 0, 72, 2400), part: 'melody' as const, voice: 5 };
  const strings = { ...note('strings', 0, 60, 2400), voice: 10 };
  score.commit([lead, strings], [], 960);
  const rest = { startTick: 1200, endTick: 1440, scope: 'lead' as const, reason: 'Foreground breath', voices: [5] };
  const events = score.events([], [rest]);
  assert.equal(events.find(event => event.id === 'lead')!.duration, 1200);
  assert.equal(events.find(event => event.id === 'strings')!.duration, 2400);
  score.commit([], [rest], 1920);
  assert.deepEqual(score.events([], []).map(event => event.id), ['strings']);
  score.commit([], [], 2880);
  assert.deepEqual(score.events([], []), []);
});

test('replacement evidence clips overlap and never resurrects a longer earlier foreground hold', () => {
  const score = new SoundingScore();
  const lead = { ...note('old', 0, 72, 4000), part: 'melody' as const, voice: 5 };
  score.commit([lead], [], 960);
  const replacement = { ...lead, id: 'new', tick: 1200, duration: 120 };
  const result = score.events([replacement], []);
  assert.equal(result.find(event => event.id === 'old')!.duration, 1200);
  assert.equal(lead.duration, 4000, 'Evidence projection never mutates a committed event.');
  score.commit([replacement], [], 1920);
  assert.deepEqual(score.events([], []), []);
});

test('implicit and explicit glides keep the same physical trajectory through scoped rests and replacements', () => {
  for (const explicit of [false, true]) {
    const score = new SoundingHarmony();
    const source: NoteEvent = { ...note('moving-source', 0, 60, 1920), endPitch: midiToPitch(72),
      ...(explicit ? { glideTicks: 1920 } : {}), gainEnvelope: [{ tick: 0, gain: .2 }, { tick: 1920, gain: 1 }] };
    const original = structuredClone(source);
    score.commit([source], [], 480);
    const rests = [{ startTick: 1200, endTick: 1440, scope: 'ensemble' as const, voices: [0], reason: 'Source release.' }];
    const projected = score.events([], rests)[0];
    assert.equal(projected.duration, 1200);
    assert.equal(projected.glideTicks, 1920);
    assert.deepEqual(projected.gainEnvelope, [{ tick: 0, gain: .2 }, { tick: 1200, gain: .7 }]);
    assert.deepEqual(notePitchAt(projected, 960), midiToPitch(66));
    assert.deepEqual(score.at([], rests, fallback)(960).voices, [midiToPitch(66)]);
    assert.deepEqual(score.at([], rests, fallback)(1200).voices, fallback.voices);
    const replaced = score.events([note('replacement', 960, 64, 120)], [])[0];
    assert.equal(replaced.duration, 960);
    assert.deepEqual(notePitchAt(replaced, 480), midiToPitch(63));
    assert.deepEqual(source, original);
  }
});

test('physical pitch queries hold endpoints and handle immediate or malformed glide durations defensively', () => {
  const moving = { ...note('moving', 120, 60, 480), endPitch: midiToPitch(64) };
  assert.deepEqual(notePitchAt(moving, 60), midiToPitch(60));
  assert.deepEqual(notePitchAt(moving, 360), midiToPitch(62));
  assert.deepEqual(notePitchAt(moving, 960), midiToPitch(64));
  assert.deepEqual(notePitchAt({ ...moving, glideTicks: 0 }, 120), midiToPitch(64));
  for (const glideTicks of [NaN, Infinity]) assert.deepEqual(notePitchAt({ ...moving, glideTicks }, 360), midiToPitch(62));
  assert.deepEqual(notePitchAt({ ...moving, absolutePitch: undefined, midiNote: 60 }, 360), midiToPitch(62));
});

test('committed sounding history is isolated from caller frames and returned evidence', () => {
  const score = new SoundingHarmony();
  const source: NoteEvent = { ...note('retained', 0, 60, 1920), endPitch: midiToPitch(72), glideTicks: 1920,
    expression: { role: 'anchor', sourceId: 'shared-subject' }, gainEnvelope: [{ tick: 0, gain: .2 }, { tick: 1920, gain: 1 }] };
  const expected = structuredClone(source);
  score.commit([source], [], 960);
  source.absolutePitch!.millicents = 0;
  source.endPitch!.millicents = 0;
  source.expression!.sourceId = 'changed-frame';
  source.gainEnvelope![0].gain = .9;
  const evidence = score.events([], []);
  assert.deepEqual(evidence, [expected]);
  evidence[0].absolutePitch!.millicents = 0;
  evidence[0].endPitch!.millicents = 0;
  evidence[0].expression!.sourceId = 'changed-projection';
  evidence[0].gainEnvelope![0].gain = .9;
  assert.deepEqual(score.events([], []), [expected]);
  assert.deepEqual(score.at([], [], fallback)(1200).voices, [midiToPitch(67.5)]);
});
