import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONDUCTOR, formAt, type FormState } from '../src/conductor';
import { DEFAULT_PARAMETERS } from '../src/parameters';
import { DEFAULT_HARMONY } from '../src/harmonic-language';
import { degreeToPitch, midiToPitch } from '../src/pitch';
import type { NoteEvent } from '../src/types';
import type { ExpressiveContour } from '../src/engine/expression';
import { realizeAccompaniment, type AccompanimentContext } from '../src/engine/accompaniment';
import { RhythmicScore, withRhythmicScore } from '../src/engine/rhythmic-score';
import { textureIntentAt } from '../src/engine/texture';
import { lyricalHarmonyWindow } from '../src/engine/lyrical-support';

const seed = 'broad-river';
const form: FormState = { ...formAt(seed, 0, DEFAULT_CONDUCTOR), sectionStartTick: 0, sectionEndTick: 1920 * 64, role: 'theme' };
const formFor = (tick: number): FormState => ({ ...form, barStartTick: Math.floor(tick / form.barTicks) * form.barTicks });
const contour = (energy: number): ExpressiveContour => ({ energy, activity: energy, intensity: energy, register: energy, sustain: 1 - energy, accent: energy, direction: 'settled' });
const templates = (tick: number): NoteEvent[] => [60, 64, 67, 71].map((midi, voice) => ({ id: 'upper:' + tick + ':' + voice, tick, duration: 990, part: 'harmony', voice, absolutePitch: midiToPitch(midi), velocity: .6 }));
const context = (tick: number, duration: number, energy: number): AccompanimentContext => ({ seed, tick, duration, form: formFor(tick), parameters: DEFAULT_PARAMETERS, expressiveAt: () => contour(energy), additive: false });
const generate = (tick: number, duration: number, energy: number, changes: Partial<AccompanimentContext> = {}) => realizeAccompaniment(templates(tick), { ...context(tick, duration, energy), ...changes });

test('calm harmony holds each chosen destination and breathes across planner frames', () => {
  const notes = generate(0, 15360, .1);
  const window = lyricalHarmonyWindow(form, DEFAULT_HARMONY), span = window.endTick - window.startTick;
  assert.equal(notes.length, 4 * Math.ceil(15360 / span));
  for (const note of notes) {
    assert.equal(note.duration, span); assert.equal(note.tick % span, 0);
    assert.equal(note.gainEnvelope?.[0].tick, 0);
    assert.equal(note.gainEnvelope?.at(-1)?.tick, note.duration);
    assert.equal(note.articulation, 'sustained');
    const gains = note.gainEnvelope!.map(point => point.gain);
    assert.ok(Math.max(...gains) > Math.min(...gains), 'A held chord contains an actual bow swell.');
  }
});

test('standalone delivery adapts through exactly the supplied common score, independently of frame partition', () => {
  const whole = generate(0, 15360, .8);
  const score = new RhythmicScore(seed, formFor);
  const textureAt = (at: number) => { const texture = textureIntentAt(DEFAULT_PARAMETERS, formFor(at), contour(.8));
    return { ...texture, rhythm: score.at(at, DEFAULT_PARAMETERS, texture) }; };
  assert.deepEqual(generate(0, 15360, .8, { harmony: DEFAULT_HARMONY, textureAt }), whole);
  assert.deepEqual(Array.from({ length: 16 }, (_, i) => generate(i * 960, 960, .8)).flat(), whole);
  generate(30720, 960, .8);
  assert.deepEqual(generate(0, 15360, .8), whole);
  const supplied = textureAt(0);
  assert.equal(withRhythmicScore(seed, formFor, DEFAULT_PARAMETERS, () => supplied)(0), supplied);
});

test('a crest admits shared source attacks while a retreat returns to connected holds', () => {
  const calm = generate(0, 15360, .1), wild = generate(0, 15360, 1);
  assert.ok(wild.length > calm.length * 2);
  assert.ok(wild.some(note => note.duration < 240));
  const score = new RhythmicScore(seed, formFor);
  for (const note of wild) {
    const window = lyricalHarmonyWindow(formFor(note.tick), DEFAULT_HARMONY);
    const texture = textureIntentAt(DEFAULT_PARAMETERS, formFor(note.tick), contour(1));
    const rhythm = score.at(note.tick, DEFAULT_PARAMETERS, texture);
    assert.equal(note.expression?.sourceId, rhythm.sourceId);
    assert.ok(note.tick === window.startTick || rhythm.accents.some(hit => hit.tick === note.tick));
    assert.ok(note.tick + note.duration <= window.endTick);
  }
  const fading = generate(0, 15360, .5, { expressiveAt: tick => contour(Math.max(0, 1 - tick / 15360)) });
  const start = fading.filter(note => note.tick < 3840), end = fading.filter(note => note.tick >= 11520);
  assert.ok(start.length > end.length);
  assert.ok(end.some(note => note.duration > 960));
});

test('native pitches and non-harmony remain intact; rest scopes clip holds and silence their onsets', () => {
  const native = templates(0).map((note, i) => ({ ...note, absolutePitch: degreeToPitch('19edo', i - 10) }));
  const bass: NoteEvent = { ...templates(0)[0], id: 'bass', part: 'bass', voice: 4, absolutePitch: midiToPitch(38) };
  const plain = realizeAccompaniment([...native, bass], context(0, 7680, .1));
  assert.equal(plain.find(note => note.id === 'bass'), bass);
  for (const note of plain.filter(note => note.part === 'harmony')) assert.deepEqual(note.absolutePitch, native[note.voice].absolutePitch);
  const rest = { startTick: 1800, endTick: 3900, scope: 'accompaniment' as const, reason: 'Written gap' };
  const rested = generate(0, 7680, .1, { rests: [rest] });
  assert.ok(rested.every(note => note.tick < rest.startTick || note.tick >= rest.endTick));
  assert.ok(rested.every(note => note.tick >= rest.endTick || note.tick + note.duration <= rest.startTick));
  assert.deepEqual(generate(0, 7680, .1, { rests: [{ ...rest, scope: 'lead', voices: [5, 6, 7] }] }), generate(0, 7680, .1));
});

test('additive gains and explicit tuning journeys survive the common structural delivery', () => {
  const original = templates(0), gliding = original.map(note => ({ ...note, endPitch: { millicents: note.absolutePitch!.millicents + 25000 }, glideTicks: 480 }));
  const additive = realizeAccompaniment(original, { ...context(0, 960, .9), additive: true });
  assert.ok(additive.every((note, voice) => note.velocity === original[voice].velocity && !note.gainEnvelope));
  const journey = realizeAccompaniment(gliding, context(0, 960, .9));
  assert.ok(journey.every((note, voice) => note.glideTicks === 480 && note.endPitch === gliding[voice].endPitch));
  for (let tick = 0; tick < 15360; tick += 960) {
    const notes = generate(tick, 960, .7);
    assert.equal(new Set(notes.map(note => note.id)).size, notes.length);
    assert.equal(new Set(notes.map(note => note.tick + ':' + note.voice)).size, notes.length);
    for (const note of notes) {
      assert.ok(note.tick >= tick && note.tick < tick + 960);
      assert.ok(Number.isSafeInteger(note.duration) && note.duration > 0);
      assert.ok(note.velocity > 0 && note.velocity <= 1);
      assert.ok(note.gainEnvelope!.every((point, i, points) => Number.isSafeInteger(point.tick) && point.tick >= 0 && point.tick <= note.duration && point.gain >= 0 && point.gain <= 1 && (i === 0 || point.tick > points[i - 1].tick)));
    }
  }
});
