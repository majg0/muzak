import test from 'node:test';
import assert from 'node:assert/strict';
import { arrangementAt, DEFAULT_ARRANGEMENT, realizeArrangement, type ArrangementContext, type ArrangementPlan } from '../src/engine/arrangement';
import { formAt, DEFAULT_CONDUCTOR } from '../src/conductor';
import { DEFAULT_PARAMETERS } from '../src/parameters';
import { textureIntentAt } from '../src/engine/texture';
import { expressiveContourAt } from '../src/engine/expression';
import { degreeToPitch, midiToPitch, pitchToDegree, TUNINGS, type TuningId } from '../src/pitch';
import type { NoteEvent } from '../src/types';
import { MusicEngine } from '../src/engine';
import { DEFAULT_PHRASING } from '../src/phrasing';
import { DEFAULT_COMPOSITION } from '../src/composition';
import { DEFAULT_SOUND } from '../src/spectrum';
import type { RhythmicMoment } from '../src/engine/rhythmic-score';

const form = (tick: number) => formAt('arrangement-contract', tick, DEFAULT_CONDUCTOR);
const texture = (tick: number) => textureIntentAt(DEFAULT_PARAMETERS, form(tick), expressiveContourAt('arrangement-contract', tick, form, 0));
const note = (voice: number, tick = 0): NoteEvent => ({ id: `player-${voice}-${tick}`, voice, tick, duration: 3840,
  part: voice === 5 ? 'melody' : 'harmony', absolutePitch: degreeToPitch('19edo', voice), velocity: .6 });

test('player exits clip known tails and use one transport boundary for the whole roster', () => {
  const context = { seed: 'arrangement-contract', tick: 0, duration: 960, additive: false, formAt: form, textureAt: texture,
    upper: [note(0), note(1), note(2), note(3)], parametersAt: (tick: number) => ({ ...DEFAULT_PARAMETERS, ensembleSize: tick < 960 ? 1 : 0 }) };
  const result = realizeArrangement([note(0), note(5)], context);
  assert.equal(result.notes.find(n => n.voice === 0)?.duration, 960);
  assert.equal(result.notes.find(n => n.voice === 5)?.duration, 3840);
  const rise = realizeArrangement([note(0, 480), note(5)], { ...context,
    parametersAt: tick => ({ ...DEFAULT_PARAMETERS, ensembleSize: tick < 480 ? 0 : 1 }) });
  assert.ok(rise.notes.every(n => n.voice === 5), 'A ramp crossing waits for the next committed roster.');
  assert.ok(rise.rests[0].voices?.includes(0));
});

test('native orchestral doubling preserves exact octave offsets and source identity', () => {
  const source = { ...note(5), expression: { role: 'anchor' as const, sourceId: 'subject' } };
  const result = realizeArrangement([source], { seed: 'arrangement-contract', tick: 0, duration: 960, additive: false,
    melodyRangeMillicents: [source.absolutePitch!.millicents, source.absolutePitch!.millicents],
    formAt: form, textureAt: texture, upper: [], parametersAt: () => ({ ...DEFAULT_PARAMETERS, ensembleSize: 1 }) });
  const flute = result.notes.find(n => n.voice === 11)!;
  assert.equal(Math.abs(flute.absolutePitch!.millicents - source.absolutePitch!.millicents), 1_200_000);
  assert.equal(flute.midiNote, undefined);
  assert.equal(flute.expression?.sourceId, 'subject');
  assert.equal(flute.timbre, 'flute');
});

test('a wide native subject uses one octave for its complete woodwind double across scheduling frames', () => {
  for (const tuning of Object.keys(TUNINGS) as TuningId[]) {
    const notes = [64, 76, 78, 76].map((midi, index): NoteEvent => ({ id: `octave-head:${index}`, voice: 5, part: 'melody',
      tick: index * 960, duration: 600, velocity: .6,
      absolutePitch: degreeToPitch(tuning, pitchToDegree(tuning, midiToPitch(midi))),
      expression: { role: 'anchor', sourceId: `head:${index}` } }));
    const context = { seed: 'wide-head', tick: 0, duration: 3840, additive: false, formAt: form, textureAt: texture,
      upper: [], parametersAt: () => ({ ...DEFAULT_PARAMETERS, ensembleSize: 1 }),
      melodyRangeMillicents: [Math.min(...notes.map(note => note.absolutePitch!.millicents)),
        Math.max(...notes.map(note => note.absolutePitch!.millicents))] as const };
    const whole = realizeArrangement(notes, context).notes.filter(note => note.voice === 11);
    const separate = notes.flatMap(note => realizeArrangement([note], { ...context, tick: note.tick, duration: 960 }).notes.filter(note => note.voice === 11));
    assert.deepEqual(whole, separate);
    assert.equal(whole.length, notes.length);
    assert.ok(whole.every((note, index) => note.absolutePitch!.millicents - notes[index].absolutePitch!.millicents === 1_200_000));
    assert.deepEqual(whole.slice(1).map((note, index) => note.absolutePitch!.millicents - whole[index].absolutePitch!.millicents),
      notes.slice(1).map((note, index) => note.absolutePitch!.millicents - notes[index].absolutePitch!.millicents));
    assert.ok(whole.every(note => note.absolutePitch!.millicents >= 6000000 && note.absolutePitch!.millicents <= 9600000));
  }
});

test('an unsupported complete range or ornament endpoint omits only the extra player', () => {
  const source: NoteEvent = { ...note(5), absolutePitch: midiToPitch(84) };
  const context = { seed: 'bounded-double', tick: 0, duration: 960, additive: false, formAt: form, textureAt: texture,
    upper: [], parametersAt: () => ({ ...DEFAULT_PARAMETERS, ensembleSize: 1 }) };
  const unplayable = realizeArrangement([source], { ...context, melodyRangeMillicents: [5200000, 9600000] });
  assert.deepEqual(unplayable.notes, [source]);
  const ornament = { ...source, id: 'slide-outlier', endPitch: midiToPitch(86), glideTicks: 240,
    expression: { role: 'ornament' as const, sourceId: 'head:ornament:slide' } };
  const bounded = realizeArrangement([source, ornament], { ...context, melodyRangeMillicents: [6000000, 8400000] });
  assert.equal(bounded.notes.filter(note => note.voice === 11).length, 1);
  assert.ok(bounded.notes.some(note => note.id === ornament.id), 'Omitting a doubled outlier cannot rewrite the primary line.');
  assert.equal(bounded.notes.find(note => note.voice === 11)!.absolutePitch!.millicents, 9600000);
});

test('the production orchestra shifts a complete low argument by one octave without folding its head or continuation', () => {
  for (const tuning of Object.keys(TUNINGS) as TuningId[]) {
    const engine = new MusicEngine({ seed: 'octave-normalization-12', parameters: { ...DEFAULT_PARAMETERS, ideaDensity: .5, ensembleSize: 1 },
      conductor: { ...DEFAULT_CONDUCTOR, amount: 0, tuningTravel: false }, sound: { ...DEFAULT_SOUND, tuning },
      phrasing: { ...DEFAULT_PHRASING, composition: { ...DEFAULT_COMPOSITION, dynamicRange: 0, embellishment: 0 } } });
    const first = engine.step(), notes = [...first.notes];
    const written = first.phrase!.themeCore!.notes;
    assert.ok(Math.min(...written.map(note => note.absolutePitchCents)) < 6000,
      'This actual source needs a whole-argument shift to fit the flute range.');
    while (engine.tick < first.phrase!.endTick) notes.push(...engine.step().notes);
    const head = written.filter(note => note.role === 'head').slice(0, 4);
    const melody = head.map(source => notes.find(note => note.voice === 5 && note.tick === source.startTick && note.expression?.sourceId === source.sourceId)!);
    const doubles = head.map(source => notes.find(note => note.voice === 11 && note.tick === source.startTick && note.expression?.sourceId === source.sourceId)!);
    assert.ok(melody.every(Boolean) && doubles.every(Boolean));
    const intervals = (line: NoteEvent[]) => line.slice(1).map((note, index) => note.absolutePitch!.millicents - line[index].absolutePitch!.millicents);
    assert.ok(intervals(melody).some(interval => Math.abs(interval) === 1_200_000));
    assert.deepEqual(intervals(doubles), intervals(melody));
    const completeMelody = written.map(source => notes.find(note => note.voice === 5 && note.tick === source.startTick && note.expression?.sourceId === source.sourceId)!);
    const completeDouble = written.map(source => notes.find(note => note.voice === 11 && note.tick === source.startTick && note.expression?.sourceId === source.sourceId)!);
    assert.ok(completeMelody.every(Boolean) && completeDouble.every(Boolean));
    assert.ok(completeDouble.every((note, index) => note.absolutePitch!.millicents - completeMelody[index].absolutePitch!.millicents === 1_200_000));
    assert.deepEqual(intervals(completeDouble), intervals(completeMelody));
    assert.ok(completeDouble.every(note => note.absolutePitch!.millicents >= 6_000_000 && note.absolutePitch!.millicents <= 9_600_000));
  }
});

const arrangementContext = (overrides: Partial<ArrangementContext> = {}): ArrangementContext => ({
  seed: 'declarative-orchestra', tick: 0, duration: 960, additive: false,
  formAt: form, textureAt: texture, upper: [], parametersAt: () => ({ ...DEFAULT_PARAMETERS, ensembleSize: 1 }), ...overrides,
});
const phraseRhythm = (ticks: number[], duration = 3840) => (tick: number) => {
  const cycleStartTick = Math.floor(tick / duration) * duration;
  return { ...texture(tick), pace: .9, rhythm: {
    startTick: cycleStartTick, endTick: cycleStartTick + duration, cycleStartTick, cycleTicks: duration,
    accents: ticks.map((offset, i) => ({ tick: cycleStartTick + offset, strength: i === 0 ? 1 : .65, role: 'anchor' as const })),
  } as RhythmicMoment };
};

test('source, instrument, range and target player compose without instrument-specific branches', () => {
  const source: NoteEvent = { ...note(8), part: 'melody', absolutePitch: midiToPitch(66),
    endPitch: midiToPitch(67), glideTicks: 240, expression: { role: 'anchor', sourceId: 'independent-subject', cueId: 'shared-entry' } };
  const plan: ArrangementPlan = { percussionEntrance: 1, players: [
    { voice: 8, role: 'counterline' },
    { voice: 17, role: 'reinforcement', source: { part: 'melody', voice: 8 }, instrument: 'glass', gain: .7,
      register: { octaves: [-1, 0], range: [4_800_000, 7_200_000], preserveSubject: true } },
  ] };
  const context = arrangementContext({ plan, sourceRangesMillicents: { 8: [6_600_000, 7_300_000] } });
  const copy = realizeArrangement([source], context).notes.find(note => note.voice === 17)!;
  assert.equal(copy.timbre, 'glass');
  assert.equal(copy.absolutePitch!.millicents, source.absolutePitch!.millicents - 1_200_000);
  assert.equal(copy.endPitch!.millicents, source.endPitch!.millicents - 1_200_000);
  assert.equal(copy.glideTicks, source.glideTicks);
  assert.equal(copy.velocity, source.velocity * .7);
  assert.deepEqual(copy.expression, { ...source.expression, role: 'support' });
  assert.deepEqual(arrangementAt(0, form(0), plan).voices, [8]);
  assert.deepEqual(arrangementAt(1, form(0), plan).voices, [8, 17]);
});

test('multi-frame roster rests agree with actual entrances and partial-frame diagnostics', () => {
  const parametersAt = (tick: number) => ({ ...DEFAULT_PARAMETERS, ensembleSize: tick < 960 || tick >= 1920 ? 0 : 1 });
  const input = [note(0, 0), note(0, 960), note(0, 1920)];
  const whole = realizeArrangement(input, arrangementContext({ duration: 2880, parametersAt }));
  assert.deepEqual(whole.notes.filter(note => note.voice === 0).map(note => [note.tick, note.duration]), [[960, 960]]);
  assert.deepEqual(whole.rests.map(rest => [rest.startTick, rest.endTick]), [[0, 960], [1920, 2880]]);
  const partial = realizeArrangement([note(0, 480)], arrangementContext({ tick: 480, duration: 240,
    parametersAt: tick => ({ ...DEFAULT_PARAMETERS, ensembleSize: tick < 480 ? 0 : 1 }) }));
  assert.deepEqual(partial.diagnostic.voices, [5]);
  assert.equal(partial.notes.length, 0);
  assert.ok(partial.rests[0].voices?.includes(0));
});

test('figuration hears all authored subdivisions and derives a stable arch from the sounding harmony', () => {
  const upper = [60, 64, 67].map((pitch, voice): NoteEvent => ({ ...note(voice), id: `harmony:${voice}`, absolutePitch: midiToPitch(pitch) }));
  const context = arrangementContext({ upper, textureAt: phraseRhythm([0, 160, 320, 480, 640, 800]) });
  const result = realizeArrangement([], context).notes.filter(note => note.voice === 14);
  assert.deepEqual(result.map(note => note.tick), [0, 160, 320, 480, 640, 800]);
  assert.deepEqual(result.map(note => note.absolutePitch!.millicents / 100_000), [72, 76, 79, 76, 72, 76]);
  assert.deepEqual(result, realizeArrangement([], { ...context, upper: [...upper].reverse() }).notes);
  assert.deepEqual(result, [0, 480].flatMap(tick => realizeArrangement([], { ...context, tick, duration: 480 }).notes));
  assert.ok(result.every((note, i) => i === result.length - 1 || note.tick + note.duration <= result[i + 1].tick));
  assert.ok(result.every(note => upper.some(source => source.id === note.expression?.sourceId)));
});

test('figuration respects source lifetimes and replacement harmony, without quoting future or expired notes', () => {
  const upper: NoteEvent[] = [
    { ...note(0), id: 'old-chord', absolutePitch: midiToPitch(60), duration: 960 },
    { ...note(0, 400), id: 'new-chord', absolutePitch: midiToPitch(62), duration: 240 },
    { ...note(1, 800), id: 'future-chord', absolutePitch: midiToPitch(67), duration: 160 },
  ];
  const context = arrangementContext({ upper, textureAt: phraseRhythm([0, 320, 480, 640, 800]) });
  const result = realizeArrangement([], context).notes;
  assert.deepEqual(result.map(note => [note.tick, note.expression?.sourceId]), [
    [0, 'old-chord'], [320, 'old-chord'], [480, 'new-chord'], [800, 'future-chord'],
  ]);
  assert.equal(result.find(note => note.tick === 320)!.duration, 80);
  assert.equal(result.find(note => note.tick === 480)!.duration, 160);
  const expired = realizeArrangement([], { ...context, upper: [{ ...upper[0], duration: 240 }] }).notes;
  assert.deepEqual(expired.map(note => note.tick), [0]);
});

test('restruck source glides begin at their physical pitch and preserve only the remaining trajectory', () => {
  const source: NoteEvent = { ...note(0), id: 'moving-harmony', duration: 960,
    absolutePitch: midiToPitch(60), endPitch: midiToPitch(72), glideTicks: 480, midiNote: 60,
    gainEnvelope: [{ tick: 0, gain: .1 }, { tick: 960, gain: .8 }] };
  const original = structuredClone(source);
  const result = realizeArrangement([], arrangementContext({ upper: [source], textureAt: phraseRhythm([240, 480]) })).notes;
  assert.equal(result[0].absolutePitch!.millicents, 7_800_000);
  assert.equal(result[0].endPitch!.millicents, 8_280_000);
  assert.equal(result[0].glideTicks, 192);
  assert.equal(result[1].absolutePitch!.millicents, 8_400_000);
  assert.equal(result[1].endPitch, undefined);
  assert.equal(result[1].glideTicks, undefined);
  assert.ok(result.every(note => note.midiNote === undefined && note.gainEnvelope === undefined));
  assert.deepEqual(source, original);
});

test('arrangement rejects ambiguous players and invalid clocks while retaining its exact endpoint roster', () => {
  assert.deepEqual(arrangementAt(0, form(0)).voices, [5]);
  assert.deepEqual(arrangementAt(1, form(0)).voices, [5, 4, 0, 3, 1, 2, 8, 10, 11, 12, 13, 14]);
  assert.throws(() => arrangementAt(NaN, form(0)), /finite/);
  assert.throws(() => arrangementAt(1, form(0), { ...DEFAULT_ARRANGEMENT, players: [DEFAULT_ARRANGEMENT.players[0], DEFAULT_ARRANGEMENT.players[0]] }), /distinct/);
  assert.throws(() => realizeArrangement([], arrangementContext({ duration: 0 })), /duration/);
  assert.throws(() => realizeArrangement([], arrangementContext({ tick: 0.5 })), /integer/);
});
