import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONDUCTOR, formAt, type FormState } from '../src/conductor';
import { DEFAULT_PARAMETERS, evaluateAutomation } from '../src/parameters';
import { DEFAULT_HARMONY } from '../src/harmonic-language';
import { midiToPitch, degreeToPitch } from '../src/pitch';
import { FRAME_TICKS, type NoteEvent } from '../src/types';
import { compositionExpressionAt } from '../src/engine/composition-expression';
import { textureIntentAt } from '../src/engine/texture';
import { realizeAccompaniment } from '../src/engine/accompaniment';
import { applyEnsembleDynamics, ensembleDynamicGain } from '../src/engine/ensemble';
import type { ExpressiveContour } from '../src/engine/expression';

const seed = 'shared-composition-reading';
const lookup = (tick: number) => formAt(seed, tick, { ...DEFAULT_CONDUCTOR, amount: .1 });
const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
const contour = (energy: number): ExpressiveContour => ({ energy, activity: energy, intensity: energy,
  register: energy, sustain: 1 - energy, accent: energy, direction: 'settled' });
const p = { ...DEFAULT_PARAMETERS, rhythmicDensity: .9, melodicActivity: .8, rhythmicComplexity: .8, dynamics: .7 };
const baseForm = lookup(0);
const form = (tick: number): FormState => ({ ...baseForm, role: 'theme', themeId: 'theme-a', sectionStartTick: 0, sectionEndTick: 30720,
  meter: { numerator: 4, denominator: 4 }, barTicks: 1920, barStartTick: Math.floor(tick / 1920) * 1920, subdivisionTicks: 120 });
const templates = (tick: number, native = false): NoteEvent[] => [55, 60, 64, 69].map((pitch, voice) => ({ id: `u${voice}`, tick, duration: 960,
  part: 'harmony', voice, velocity: .65, absolutePitch: native ? degreeToPitch('19edo', [-22, -14, -8, 0][voice]) : midiToPitch(pitch) }));
const backing = (level: number, tick: number, duration: number, additive = false, native = false) => realizeAccompaniment(templates(tick, native), {
  seed, tick, duration, form: form(tick), parameters: p, harmony: DEFAULT_HARMONY,
  textureAt: at => textureIntentAt(p, form(at), contour(level)), expressiveAt: () => contour(level), additive,
});

test('the shared composition reading is independent of form freedom, neutral at zero breadth and preserves explicit controls last', () => {
  const neutral = compositionExpressionAt(seed, 10000, DEFAULT_PARAMETERS, lookup, 0);
  assert.deepEqual(neutral.parameters, DEFAULT_PARAMETERS);
  assert.deepEqual(neutral.expression, { energy: .5, intensity: .5, activity: .5, register: .5, sustain: .5, accent: .5, ideaDensity: .5, ensembleSize: .5, direction: 'settled' });
  for (let tick = 0; tick < 100000; tick += 960) {
    const reading = compositionExpressionAt(seed, tick, DEFAULT_PARAMETERS, lookup, 1);
    assert.equal(reading.parameters.tempo, DEFAULT_PARAMETERS.tempo);
    const overridden = evaluateAutomation(reading.parameters, [
      { parameter: 'dynamics', points: [{ tick: 0, value: .31, curve: 'step' }] },
      { parameter: 'rhythmicDensity', points: [{ tick: 0, value: .22, curve: 'step' }] },
      { parameter: 'tempo', points: [{ tick: 0, value: 91, curve: 'step' }] },
    ], tick);
    assert.equal(overridden.dynamics, .31); assert.equal(overridden.rhythmicDensity, .22); assert.equal(overridden.tempo, 91);
  }
});

test('calm-to-crest change spans pacing, density, brightness and dynamics rather than just overall loudness', () => {
  const forms: FormState[] = [];
  for (let tick = 0; forms.length < 32;) { const current = lookup(tick); forms.push(current); tick = current.sectionEndTick; }
  const calm = forms.find(value => value.role === 'breakdown')!, peak = forms.find(value => value.role === 'climax')!;
  const samples = (value: FormState) => [.3, .4, .5, .6].map(fraction => compositionExpressionAt(seed,
    Math.round(value.sectionStartTick + (value.sectionEndTick - value.sectionStartTick) * fraction), DEFAULT_PARAMETERS, lookup, 1));
  const a = samples(calm), b = samples(peak);
  for (const key of ['dynamics', 'rhythmicDensity', 'texturalDensity'] as const) assert.ok(mean(b.map(v => v.parameters[key])) - mean(a.map(v => v.parameters[key])) > .55, key);
  assert.ok(mean(b.map(v => v.parameters.brightness)) - mean(a.map(v => v.parameters.brightness)) > .3);
  assert.ok(mean(a.map(v => v.texture.pace)) < .3 && mean(b.map(v => v.texture.pace)) > .8);
  assert.ok(a.every(v => v.texture.articulation === 'sustained'));
  assert.ok(b.every(v => v.texture.subdivisionTicks <= 120));
  const deviations = b.map(v => v.expression.activity - v.expression.intensity);
  assert.ok(Math.max(...deviations) - Math.min(...deviations) > .01, 'Activity breathes separately from the broad dynamic contour.');
});

test('composition expression agrees at section and phrase boundaries and does not depend on call order', () => {
  for (let tick = 0, section = 0; section < 20; section++) {
    const current = lookup(tick), boundaries = [current.sectionEndTick];
    for (let at = current.sectionStartTick; at < current.sectionEndTick; at += FRAME_TICKS) {
      const now = lookup(at); if (at === now.phraseStartTick && at > 0) boundaries.push(at);
    }
    for (const boundary of boundaries) {
      const before = compositionExpressionAt(seed, boundary - 1, DEFAULT_PARAMETERS, lookup, 1);
      const after = compositionExpressionAt(seed, boundary, DEFAULT_PARAMETERS, lookup, 1);
      for (const key of ['energy', 'activity', 'intensity', 'register', 'sustain', 'accent'] as const) assert.ok(Math.abs(before.expression[key] - after.expression[key]) < .002, `${key} ${boundary}`);
      for (const key of ['dynamics', 'rhythmicDensity', 'brightness'] as const) assert.ok(Math.abs(before.parameters[key] - after.parameters[key]) < .002);
      assert.deepEqual(compositionExpressionAt(seed, boundary - 1, DEFAULT_PARAMETERS, lookup, 1), before);
    }
    tick = current.sectionEndTick;
  }
});

test('one harmonic identity has held, connected and shared-pulse realizations with current native pitches', () => {
  const calm = backing(.02, 0, 15360), flowing = backing(.5, 0, 15360), crest = backing(.98, 0, 15360);
  assert.equal(calm.length, 32); assert.ok(calm.every(note => note.duration === 1920 && note.tick % 1920 === 0 && note.articulation === 'sustained'));
  assert.ok(flowing.length > calm.length && crest.length > flowing.length);
  assert.ok(mean(calm.map(note => note.duration)) > mean(crest.map(note => note.duration)) * 6);
  for (const level of [.02, .5, .98]) {
    const whole = backing(level, 0, 15360), split = Array.from({ length: 16 }, (_, index) => backing(level, index * 960, 960)).flat();
    assert.deepEqual(split, whole);
    for (const note of whole) {
      assert.deepEqual(note.absolutePitch, templates(0)[note.voice].absolutePitch);
      assert.ok(note.tick + note.duration <= (Math.floor(note.tick / 1920) + 1) * 1920, 'No old chord tail extends into a new destination.');
      const next = whole.find(candidate => candidate.voice === note.voice && candidate.tick > note.tick);
      if (next) assert.ok(note.tick + note.duration <= next.tick);
    }
  }
  const additive = backing(.98, 0, 15360, true, true);
  assert.equal(additive.length, calm.length, 'The additive instrument keeps the simultaneous reference bed.');
  for (const note of additive) {
    assert.deepEqual(note.absolutePitch, templates(0, true)[note.voice].absolutePitch);
    assert.equal(note.velocity, .65); assert.equal(note.gainEnvelope, undefined);
  }
});

test('wider dynamic realization has an audible low floor, neutral midpoint and a continuous retreat ceiling', () => {
  assert.equal(ensembleDynamicGain(.5, 1), 1); assert.equal(ensembleDynamicGain(0, 0), 1);
  assert.ok(ensembleDynamicGain(0, 1) >= .48 && ensembleDynamicGain(1, 1) >= 1.7);
  const low = applyEnsembleDynamics(templates(0), 0, 1, false, at => textureIntentAt(p, form(at), contour(0)));
  const high = applyEnsembleDynamics(templates(0), 1, 1, false, at => textureIntentAt(p, form(at), contour(1)));
  assert.ok(low.every(note => note.velocity >= .3));
  assert.ok(mean(high.map(note => note.velocity)) / mean(low.map(note => note.velocity)) > 3);
  for (let i = 1; i <= 100; i++) assert.ok(ensembleDynamicGain(i / 100, 1) >= ensembleDynamicGain((i - 1) / 100, 1));
  assert.deepEqual(applyEnsembleDynamics(templates(0, true), 0, 1, true), templates(0, true));
});

test('structural bass roots cannot disappear and active contours stay inside the actual native sonority', () => {
  for (const native of [false, true]) {
    const bass: NoteEvent = { id: 'root', tick: 0, duration: 960, part: 'bass', voice: 4, velocity: .7,
      absolutePitch: native ? degreeToPitch('19edo', -57) : midiToPitch(36) };
    const foreign: NoteEvent = { ...bass, id: 'groove-contour', tick: 480, duration: 480,
      absolutePitch: native ? degreeToPitch('19edo', -53) : midiToPitch(38) };
    const run = (level: number, tick: number, duration: number) => realizeAccompaniment([...templates(tick, native),
      ...(foreign.tick >= tick && foreign.tick < tick + duration ? [foreign] : [])], {
      seed, tick, duration, form: form(tick), parameters: p, harmony: DEFAULT_HARMONY, bassTemplate: bass, tuning: native ? '19edo' : '12tet',
      textureAt: at => textureIntentAt(p, form(at), contour(level)), expressiveAt: () => contour(level), additive: false,
    });
    for (const level of [.02, .98]) {
      const notes = run(level, 0, 3840), lower = notes.filter(note => note.part === 'bass');
      assert.deepEqual(Array.from({ length: 4 }, (_, index) => run(level, index * 960, 960)).flat(), notes);
      for (const at of [0, 1920]) assert.deepEqual(lower.find(note => note.tick === at)!.absolutePitch, bass.absolutePitch);
      const classes = [bass, ...templates(0, native)].map(note => ((note.absolutePitch!.millicents % 1200000) + 1200000) % 1200000);
      for (const note of lower) {
        assert.ok(classes.includes(((note.absolutePitch!.millicents % 1200000) + 1200000) % 1200000));
        assert.ok(note.tick + note.duration <= (Math.floor(note.tick / 1920) + 1) * 1920);
      }
      if (level < .3) assert.ok(lower.every(note => note.duration === 1920));
    }
  }
});
