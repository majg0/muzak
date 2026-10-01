import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONDUCTOR, formAt, type FormState } from '../src/conductor';
import { DEFAULT_COMPOSITION } from '../src/composition';
import { DEFAULT_PARAMETERS, DEFAULT_WEIGHTS } from '../src/parameters';
import { degreeToPitch, midiToPitch } from '../src/pitch';
import { DEFAULT_SOUND } from '../src/spectrum';
import { FRAME_TICKS, type NoteEvent } from '../src/types';
import { inLyricalField, lyricalField, lyricalHarmonyWindow, lyricalTexture, lyricalNeighborPenalty } from '../src/engine/lyrical-support';
import { textureIntentAt } from '../src/engine/texture';
import { realizeAccompaniment } from '../src/engine/accompaniment';
import { coordinateEnsemble } from '../src/engine/ensemble';
import { plan, type HarmonicState } from '../src/engine/planner';
import { initialEdo19State, planEdo19, validEdo19Voices } from '../src/engine/edo19';
import { dissonance, validVoices } from '../src/engine/analysis';
import { createRoughnessScorer } from '../src/engine/roughness-scoring';
import type { PlanningIntent } from '../src/engine/intent';
import { DEFAULT_HARMONY } from '../src/harmonic-language';

const initial = formAt('lyrical-support', 0, DEFAULT_CONDUCTOR);
const form: FormState = { ...initial, sectionStartTick: 0, sectionEndTick: 15360, barTicks: 1920, barStartTick: 0 };
const expression = { energy: .8, activity: .8, intensity: .8, register: .6, sustain: .9, accent: .5, direction: 'settled' as const };
const upper = (tick: number): NoteEvent[] => [55, 60, 64, 69].map((midi, voice) => ({ id: `u${voice}`, tick, duration: 990,
  absolutePitch: midiToPitch(midi), part: 'harmony', voice, velocity: .5 }));
const p = { ...DEFAULT_PARAMETERS, harmonicMobility: .6, harmonicSurprise: .4, voiceLeading: .9, tonalClarity: .93,
  tonalGravity: .9, dissonance: .12, chromaticism: .06, bassIndependence: .1, bassMobility: .35 };

test('lyrical structural windows cover complete true bars and align every harmonic commit', () => {
  for (const seed of ['glass-garden', 'velvet-orbit', 'amber-current']) {
    let previousEnd = 0;
    for (let tick = 0; tick < 400000; tick += FRAME_TICKS) {
      const state = formAt(seed, tick, DEFAULT_CONDUCTOR), window = lyricalHarmonyWindow(state);
      assert.ok(window.startTick <= tick && window.endTick > tick);
      assert.equal(window.startTick % FRAME_TICKS, 0); assert.equal(window.endTick % FRAME_TICKS, 0);
      assert.equal((window.startTick - state.sectionStartTick) % state.barTicks, 0);
      assert.equal((window.endTick - state.sectionStartTick) % state.barTicks, 0);
      if (tick === previousEnd) assert.equal(window.startTick, tick);
      previousEnd = window.endTick;
    }
  }
});

test('lyrical texture reserves the foreground while retaining the expressive loudness contour', () => {
  const high = textureIntentAt(p, form, expression), low = textureIntentAt(p, form, { ...expression, intensity: .1, activity: .1 });
  const highLyric = lyricalTexture(high), lowLyric = lyricalTexture(low);
  assert.ok(highLyric.pace < .3 && highLyric.syncopation < .06 && highLyric.rhythmDrive <= .1);
  assert.equal(highLyric.subdivisionTicks, 480); assert.equal(highLyric.articulation, 'sustained');
  assert.equal(highLyric.velocityCeiling, high.velocityCeiling); assert.equal(lowLyric.velocityCeiling, low.velocityCeiling);
  assert.ok(highLyric.velocityCeiling > lowLyric.velocityCeiling);
});

test('committed thought boundaries own backing destinations even between the section bar lines', () => {
  const thought = { startTick: 4800, endTick: 8640 };
  const structural = { ...form, barTicks: 1440, barStartTick: 4320 };
  const generate = (tick: number, duration: number) => {
    const bass: NoteEvent = { id: 'reference-bass', tick, duration: 990, absolutePitch: midiToPitch(36), part: 'bass', voice: 4, velocity: .5 };
    return realizeAccompaniment([...upper(tick), bass], { seed: 'short-thought', tick, duration, form: structural,
      parameters: p, expressiveAt: () => expression, additive: true, harmony: DEFAULT_HARMONY,
      harmonySpan: thought, bassTemplate: bass, textureAt: () => textureIntentAt(p, structural, expression) });
  };
  const whole = generate(thought.startTick, thought.endTick - thought.startTick);
  const parts = Array.from({ length: 4 }, (_, index) => generate(thought.startTick + index * FRAME_TICKS, FRAME_TICKS)).flat();
  assert.deepEqual(parts, whole);
  assert.deepEqual([...new Set(whole.map(note => note.tick))], [4800, 7680]);
  for (const voice of [0, 1, 2, 3, 4]) {
    assert.deepEqual(whole.filter(note => note.voice === voice).map(note => [note.tick, note.duration]), [[4800, 2880], [7680, 960]]);
  }
  assert.ok(whole.every(note => !note.gainEnvelope && note.tick + note.duration <= thought.endTick));
});

test('held-lead spacing prefers room without outlawing extensions or octave-separated neighbors', () => {
  assert.equal(lyricalNeighborPenalty([6100, 6400, 6800, 7100], [6900]), 1);
  assert.equal(lyricalNeighborPenalty([5700, 6200, 6600, 6900], [6900]), 0);
  assert.equal(lyricalNeighborPenalty([5700, 6200, 6500, 6800], [8100]), 0);
  assert.equal(lyricalNeighborPenalty([6100, 6400, 6700, 7200], [6900]), 0);
  assert.ok(lyricalNeighborPenalty([6800], [6863.158]) > 0, 'The same physical rule includes native19 near-neighbors.');
});

test('four lyrical strings hold their actual chosen pitches across structural spans without repeated cue attacks', () => {
  const generate = (tick: number, duration: number) => realizeAccompaniment(upper(tick), { seed: 'long-bed', tick, duration,
    parameters: p, form: { ...form, barStartTick: Math.floor(tick / 1920) * 1920 }, expressiveAt: () => expression,
    additive: false, textureAt: () => lyricalTexture(textureIntentAt(p, form, expression)) });
  const notes = generate(0, 15360), split = Array.from({ length: 16 }, (_, index) => generate(index * 960, 960)).flat();
  assert.deepEqual(split, notes);
  const span = lyricalHarmonyWindow(form, DEFAULT_HARMONY).endTick;
  assert.equal(notes.length, 4 * 15360 / span); assert.ok(notes.every(note => note.duration === span && note.tick % span === 0));
  assert.ok(notes.every(note => note.timbre === 'strings' && note.articulation === 'sustained'));
  const coordinated = coordinateEnsemble(notes.slice(0, 4), { tick: 0, duration: 960, beatTicks: 480, seed: 'long-bed',
    cues: [{ id: 'entry', tick: 240, kind: 'entry', strength: 1 }, { id: 'arrival', tick: 720, kind: 'arrival', strength: 1 }],
    rests: [], additive: false, lyrical: true, config: { ...DEFAULT_COMPOSITION, accent: 0, dynamicRange: 0 } });
  assert.deepEqual(coordinated, notes.slice(0, 4));
  const glides = upper(0).map(note => ({ ...note, endPitch: degreeToPitch('19edo', note.voice), glideTicks: 768 }));
  const journey = realizeAccompaniment(glides, { seed: 'long-bed', tick: 0, duration: 960, parameters: p, form,
    expressiveAt: () => expression, additive: false });
  assert.ok(journey.every(note => note.duration === span && note.glideTicks === 768 && note.endPitch));
  const additive = realizeAccompaniment(glides, { seed: 'long-bed', tick: 0, duration: 960, parameters: p, form,
    expressiveAt: () => expression, additive: true });
  assert.ok(additive.every((note, voice) => note.duration === span && note.glideTicks === 768
    && note.velocity === glides[voice].velocity && note.gainEnvelope === undefined));
});

test('both planners hold exactly between changes and immediately enter their declared native lyrical field', () => {
  const targets = [6400, 6500, 6900, 6700, 6200, 6400];
  const intent = (index: number): PlanningIntent => ({ targetTension: .28, lyrical: true, holdHarmony: index % 4 !== 0,
    tonalCenter12: 0, centerDegree19: 0, homeRoot: 0, homeThird: 4, homeStrength: .1,
    melodyTargetsCents: [targets[Math.floor(index / 4) % targets.length]], melodySupport: 2 });
  let state: HarmonicState = { voices: [54, 61, 66, 73], bass: 37, center: 0, index: 0, recent: [] };
  let native = initialEdo19State('lyrical-support');
  const scorer = createRoughnessScorer(DEFAULT_SOUND, degree => degreeToPitch('19edo', degree));
  const collections = new Set<string>(), frictions: number[] = [];
  for (let index = 0; index < 24; index++) {
    const previous = state, before = native;
    const result = plan('lyrical-support', state, () => p, DEFAULT_WEIGHTS, undefined, intent).winner;
    const other = planEdo19('lyrical-support', native, () => p, DEFAULT_WEIGHTS, scorer, intent).winner;
    state = result.state; native = other.state;
    assert.equal(state.index, index + 1); assert.equal(native.index, index + 1);
    assert.ok(validVoices(state.voices) && validEdo19Voices(native.upperDegrees));
    assert.ok(inLyricalField(state.voices, state.bass, 0, '12tet', 4));
    assert.ok(inLyricalField(native.upperDegrees, native.bassDegree, 0, '19edo', 4));
    if (index > 0) {
      assert.ok(state.voices.every((pitch, voice) => Math.abs(pitch - previous.voices[voice]) <= 2));
      assert.ok(native.upperDegrees.every((pitch, voice) => Math.abs(pitch - before.upperDegrees[voice]) <= 3));
    }
    if (index % 4) {
      assert.deepEqual(state.voices, previous.voices); assert.equal(state.bass, previous.bass);
      assert.deepEqual(native.upperDegrees, before.upperDegrees); assert.equal(native.bassDegree, before.bassDegree);
      assert.equal(result.movement, 0); assert.equal(other.movementCents, 0);
    } else { collections.add(`${state.voices.join(',')}/${state.bass}`); frictions.push(dissonance(state.voices, state.bass)); }
  }
  assert.ok(collections.size >= 3, 'Long holds still support changing phrases instead of a fixed tonic drone.');
  assert.ok(frictions.reduce((sum, value) => sum + value, 0) / frictions.length < .28);
  assert.deepEqual(lyricalField('19edo', 3), [0, 3, 5, 8, 11, 13, 16]);
});
