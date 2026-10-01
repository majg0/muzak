import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONDUCTOR, formAt, type FormState } from '../src/conductor';
import { DEFAULT_COMPOSITION } from '../src/composition';
import { DEFAULT_PARAMETERS } from '../src/parameters';
import { degreeToPitch, midiToPitch, pitchToDegree } from '../src/pitch';
import type { NoteEvent } from '../src/types';
import { textureIntentAt, type TextureAt } from '../src/engine/texture';
import type { ExpressiveContour } from '../src/engine/expression';
import { realizeAccompaniment } from '../src/engine/accompaniment';
import { CounterpointLayer } from '../src/engine/counterpoint';
import { composeThemeCore, themeThird } from '../src/engine/theme-core';
import { grooveNotes } from '../src/engine/groove';
import { planTransitions } from '../src/engine/transitions';
import { realizeEnsembleFills } from '../src/engine/ensemble-fill';
import { applyEnsembleDynamics, ensembleDynamicGain } from '../src/engine/ensemble';
import { RhythmicScore } from '../src/engine/rhythmic-score';
import { DEFAULT_HARMONY } from '../src/harmonic-language';

const seed = 'shared-textural-river';
const p = { ...DEFAULT_PARAMETERS, rhythmicDensity: .9, rhythmicComplexity: .9, metricStability: .4, melodicActivity: .8, dynamics: .7 };
const initial = formAt(seed, 0, DEFAULT_CONDUCTOR);
const form = (tick: number): FormState => ({ ...initial, role: 'theme', themeId: 'theme-a', sectionIndex: 0,
  sectionStartTick: 0, sectionEndTick: 1920 * 64, meter: { numerator: 4, denominator: 4 }, barTicks: 1920,
  barStartTick: Math.floor(tick / 1920) * 1920, bar: Math.floor(tick / 1920), grooveId: 'same-cell', swing: 0, subdivisionTicks: 120 });
const contour = (energy: number): ExpressiveContour => ({ energy, activity: energy, intensity: energy, register: energy,
  sustain: 1 - energy, accent: energy, direction: 'settled' });
const scoredTexture = (plain: TextureAt): TextureAt => {
  const score = new RhythmicScore(seed, form, DEFAULT_COMPOSITION);
  return tick => { const texture = plain(tick); return { ...texture, rhythm: score.at(tick, p, texture) }; };
};
const texture = (energy: number): TextureAt => scoredTexture(tick => textureIntentAt(p, form(tick), contour(energy)));
const upper = (tick = 0): NoteEvent[] => [55, 60, 64, 69].map((midi, voice) => ({ id: `upper:${voice}`, tick,
  duration: 990, part: 'harmony', voice, absolutePitch: midiToPitch(midi), velocity: .65 }));
const bass: NoteEvent = { id: 'bass', tick: 0, duration: 700, part: 'bass', voice: 4, absolutePitch: midiToPitch(36), velocity: .7 };
const harmony = (energy: number, tick = 0, duration = 15360) => realizeAccompaniment(upper(tick), { seed, tick, duration,
  form: form(tick), parameters: p, harmony: DEFAULT_HARMONY, expressiveAt: () => contour(energy), textureAt: texture(energy), additive: false });
const groove = (textureAt: TextureAt, tick = 0, duration = 15360) => grooveNotes(seed, tick, duration, form, p, '12tet', 36, 55, midiToPitch,
  { composition: { ...DEFAULT_COMPOSITION, displacement: 1, polymeter: 1 }, textureAt });
const mean = (numbers: number[]) => numbers.reduce((sum, value) => sum + value, 0) / numbers.length;

test('one continuous texture policy slows time articulation without altering tempo or musical parameters', () => {
  const before = structuredClone(p), calm = texture(.02)(0), crest = texture(.98)(0);
  assert.ok(calm.pace < .3 && crest.pace > .8);
  assert.equal(calm.subdivisionTicks, 480); assert.equal(crest.subdivisionTicks, 120);
  assert.equal(calm.articulation, 'sustained'); assert.ok(calm.gateRatio > 1.2);
  assert.ok(calm.syncopation < crest.syncopation * .2 && calm.attackSoftness > crest.attackSoftness * 2);
  assert.ok(calm.velocityCeiling > .5, 'Softness is not encoded as an almost-silent ceiling.');
  for (let energy = .01; energy < 1; energy += .01) {
    const a = texture(energy)(0), b = texture(energy - .001)(0);
    for (const key of ['pace', 'syncopation', 'gateRatio', 'attackSoftness', 'rhythmDrive', 'velocityCeiling'] as const) assert.ok(Math.abs(a[key] - b[key]) < .005);
  }
  assert.deepEqual(p, before);
});

test('calm upper voices and bass sustain metrical attacks while crest figures develop across all backing parts', () => {
  const calmUpper = harmony(.02), fastUpper = harmony(.98), calmBeat = groove(texture(.02)), fastBeat = groove(texture(.98));
  assert.ok(calmUpper.every(note => note.tick % 480 === 0 && note.duration > 1440 && note.articulation === 'sustained'));
  assert.ok(calmBeat.every(note => note.tick % 480 === 0));
  assert.ok(calmBeat.filter(note => note.part === 'bass').every(note => note.duration >= 1800 && note.articulation === 'sustained'));
  assert.ok(fastUpper.length > calmUpper.length * 2);
  assert.ok(fastBeat.filter(note => note.part === 'bass').length > calmBeat.filter(note => note.part === 'bass').length * 3);
  assert.ok(fastBeat.filter(note => note.part === 'percussion').length > calmBeat.filter(note => note.part === 'percussion').length,
    'A crest adds source-derived detail around the continuing reference pulse.');
  const reference = (notes: NoteEvent[]) => notes.filter(note => note.expression?.sourceId === 'reference:quarter')
    .map(note => [note.tick, note.midiNote]);
  assert.deepEqual(reference(fastBeat), reference(calmBeat), 'Texture density cannot replace the shared timekeeping clock.');
  const bassTicks = new Set(fastBeat.filter(note => note.part === 'bass').map(note => note.tick));
  const drumTicks = new Set(fastBeat.filter(note => note.part === 'percussion').map(note => note.tick));
  const shared = fastUpper.filter(note => note.tick % 480 !== 0 && bassTicks.has(note.tick) && drumTicks.has(note.tick));
  assert.ok(shared.length > 8, 'Fine shared figures are played by harmony, bass and drums, not only a soloist.');
  assert.ok(mean(calmUpper.flatMap(note => note.gainEnvelope!.map(point => point.gain))) > .55);
});

test('shared rhythm and held accompaniment are frame-independent and keep native ranges and authored silence', () => {
  const at = texture(.98), whole = groove(at), pieces = Array.from({ length: 16 }, (_, index) => groove(at, index * 960, 960)).flat();
  assert.deepEqual(pieces, whole);
  const partUpper = Array.from({ length: 16 }, (_, index) => harmony(.98, index * 960, 960)).flat();
  assert.deepEqual(partUpper, harmony(.98));
  const native = grooveNotes(seed, 0, 15360, form, p, '19edo', -50, -22, degree => degreeToPitch('19edo', degree),
    { composition: DEFAULT_COMPOSITION, textureAt: at, rests: [{ startTick: 3000, endTick: 4500, scope: 'ensemble', reason: 'Shared silence.' }] });
  for (const note of native) {
    assert.ok(note.tick < 3000 || note.tick >= 4500);
    assert.ok(note.tick >= 4500 || note.tick + note.duration <= 3000);
    if (note.part === 'bass') {
      const degree = pitchToDegree('19edo', note.absolutePitch!);
      assert.ok(degree >= -65 && degree <= -33);
      assert.deepEqual(note.absolutePitch, degreeToPitch('19edo', degree)); assert.equal(note.midiNote, undefined);
    }
  }
  const line = whole.filter(note => note.part === 'bass');
  assert.ok(line.slice(1).every((note, index) => line[index].tick + line[index].duration <= note.tick));
  const rising = scoredTexture(tick => textureIntentAt(p, form(tick), contour(Math.min(.98, .02 + tick / 15360))));
  const rise = groove(rising), riseLine = rise.filter(note => note.part === 'bass');
  assert.ok(riseLine.slice(1).every((note, index) => riseLine[index].tick + riseLine[index].duration <= note.tick),
    'A calm held bass yields to the next foundation attack when the texture enters its rising phase.');
  assert.deepEqual(Array.from({ length: 16 }, (_, index) => groove(rising, index * 960, 960)).flat(), rise);
});

test('independent answers leave calm space and quote thematic material on a reproducible active clock', () => {
  const layer = new CounterpointLayer(seed, { ...DEFAULT_COMPOSITION, displacement: 1 }, 4, form);
  const calm = layer.notes(0, 30720, p, '12tet', texture(.02));
  const fast = layer.notes(0, 30720, p, '12tet', texture(.98));
  assert.equal(calm.length, 0, 'Quiet texture deliberately leaves the main subject alone.');
  assert.ok(fast.length >= 12);
  assert.ok(fast.every(note => note.expression?.sourceId?.includes('core:theme-a:head:')));
  const cycles = new Map<string, NoteEvent[]>();
  for (const note of fast) { const cycle = note.id.split(':')[1]; cycles.set(cycle, [...(cycles.get(cycle) ?? []), note]); }
  const headCount = composeThemeCore(seed, 'theme-a', themeThird(seed, 'theme-a')).clauses[0].notes.length;
  const complete = [...cycles.values()].filter(notes => notes.length === headCount);
  assert.ok(complete.length >= 2);
  const intervals = (notes: NoteEvent[]) => notes.slice(1).map((note, index) => note.absolutePitch!.millicents - notes[index].absolutePitch!.millicents);
  for (const notes of complete.slice(1)) assert.deepEqual(intervals(notes), intervals(complete[0]));
  const split = Array.from({ length: 32 }, (_, index) => layer.notes(index * 960, 960, p, '12tet', texture(.98))).flat();
  assert.deepEqual(split, fast);
  const native = layer.notes(0, 30720, p, '19edo', texture(.98));
  for (const note of native) {
    assert.deepEqual(note.absolutePitch, degreeToPitch('19edo', pitchToDegree('19edo', note.absolutePitch!)));
    assert.ok(note.absolutePitch!.millicents >= 5370000 && note.absolutePitch!.millicents <= 8030000);
  }
  assert.deepEqual(layer.notes(0, 30720, p, '12tet', texture(.98)), fast);
});

test('retreat fills inherit the destination pace and velocity ceiling, including percussion', () => {
  const plans = planTransitions(seed, [{ id: 'retreat', tick: 3840, kind: 'section' }], { ...p, tension: .95 }, 1);
  const high = texture(.98), low = texture(.02);
  const falling = scoredTexture(tick => textureIntentAt(p, form(tick), contour(Math.max(.02, .98 - Math.max(0, tick - 1920) / 1920))));
  const make = (textureAt: TextureAt) => {
    const drums = grooveNotes(seed, 0, 4800, form, p, '12tet', 36, 55, midiToPitch, { composition: DEFAULT_COMPOSITION, textureAt, transitionPlans: plans });
    return realizeEnsembleFills([...upper(), bass, ...drums], { seed, tick: 0, duration: 4800, plans, parameters: p,
      tuning: '12tet', additive: false, templates: upper(), bassTemplate: bass, textureAt });
  };
  const receding = make(falling), intense = make(high);
  const added = (notes: NoteEvent[]) => notes.filter(note => note.id.startsWith('fill:'));
  assert.ok(added(receding.notes).length < added(intense.notes).length);
  const late = receding.notes.filter(note => note.tick >= 3360 && (note.id.startsWith('fill:') || note.id.startsWith('transition:')));
  assert.ok(late.length > 0);
  assert.ok(late.every(note => note.tick % 480 === 0 && note.velocity <= falling(note.tick).velocityCeiling));
  const arrival = added(receding.notes).filter(note => note.tick === 3840);
  assert.ok(arrival.every(note => note.velocity <= low(3840).velocityCeiling && note.articulation === 'sustained'));
  const rested = grooveNotes(seed, 0, 4800, form, p, '12tet', 36, 55, midiToPitch, { composition: DEFAULT_COMPOSITION,
    textureAt: falling, transitionPlans: plans, rests: [{ startTick: 3600, endTick: 4200, scope: 'ensemble', reason: 'An authored break.' }] });
  assert.ok(rested.every(note => note.tick < 3600 || note.tick >= 4200));
});

test('quiet ensemble dynamics stay audible and additive matching remains unchanged', () => {
  assert.ok(ensembleDynamicGain(0, 1) > .45);
  assert.ok(ensembleDynamicGain(1, 1) / ensembleDynamicGain(0, 1) > 2.5);
  assert.equal(ensembleDynamicGain(.02, 0), 1);
  const source = [...upper(), bass];
  const calm = applyEnsembleDynamics(source, .02, 1, false, texture(.02));
  assert.ok(calm.every((note, index) => note.velocity > source[index].velocity * .45));
  assert.deepEqual(applyEnsembleDynamics(source, .02, 1, true, texture(.02)), source);
});
