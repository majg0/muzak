import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_COMPOSITION } from '../src/composition';
import { DEFAULT_CONDUCTOR, formAt } from '../src/conductor';
import { MusicEngine } from '../src/engine';
import { CounterpointLayer } from '../src/engine/counterpoint';
import { applyEnsembleDynamics, ensembleDynamicGain } from '../src/engine/ensemble';
import { realizeEnsembleFills } from '../src/engine/ensemble-fill';
import { clipPhraseRests, PhraseLayer } from '../src/engine/phrase';
import { integer } from '../src/engine/random';
import { planTransitions } from '../src/engine/transitions';
import { DEFAULT_PARAMETERS } from '../src/parameters';
import { DEFAULT_PHRASING } from '../src/phrasing';
import { DEFAULT_SOUND } from '../src/spectrum';
import { FRAME_TICKS, type AutomationLane, type Frame, type NoteEvent } from '../src/types';
import { ScoreTimeline } from '../src/engine/score-timeline';

const seed = 'glass-garden';
const conductor = { ...DEFAULT_CONDUCTOR, tuningTravel: false };
const composition = { ...DEFAULT_COMPOSITION, dynamicRange: 1 };
const phrasing = { ...DEFAULT_PHRASING, composition };
const rounded = (value: number) => Math.round(value * 1e6) / 1e6;
const average = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
const intensity = (frame: Frame) => frame.diagnostics.compositionExpression!.intensity;
// Compare expressive delivery with one unchanged source density and roster.
// Independent density/arrangement endpoint behavior is tested in range-integration.
const automation: AutomationLane[] = [
  { parameter: 'ideaDensity', points: [{ tick: 0, value: .5, curve: 'step' }] },
  { parameter: 'ensembleSize', points: [{ tick: 0, value: 1, curve: 'step' }] },
];
const timeline = new ScoreTimeline({ seed, parameters: DEFAULT_PARAMETERS, conductor, phrasing, automation });
const textureAt = timeline.textureAt;
const fixtures = new Map<number, Frame[]>();
function performance(breadth: number): Frame[] {
  if (!fixtures.has(breadth)) {
    const engine = new MusicEngine({ seed, parameters: DEFAULT_PARAMETERS, conductor, automation,
      phrasing: { ...phrasing, composition: { ...composition, dynamicRange: breadth } } });
    fixtures.set(breadth, Array.from({ length: 320 }, () => engine.step()));
  }
  return fixtures.get(breadth)!;
}

test('the complete orchestra keeps calm audible while crest activity develops across the backing parts', () => {
  const contrast = (frames: Frame[]) => {
    const quiet = frames.filter(frame => intensity(performance(1)[frame.index]) < .25).flatMap(frame => frame.notes.map(note => note.velocity));
    const peak = frames.filter(frame => intensity(performance(1)[frame.index]) > .72).flatMap(frame => frame.notes.map(note => note.velocity));
    assert.ok(quiet.length > 100 && peak.length > 100, 'Both comparisons include substantial played material.');
    return { quiet: average(quiet), peak: average(peak) };
  };
  const narrow = contrast(performance(0)), wide = contrast(performance(1));
  assert.ok(wide.peak / wide.quiet > narrow.peak / narrow.quiet * 1.5);
  assert.ok(wide.quiet < narrow.quiet && wide.peak > narrow.peak);
  assert.ok(wide.quiet > .12, 'Quiet ensemble notes retain a moderate audible written floor.');
  const calmFrames = performance(1).filter(frame => textureAt(frame.tick).pace < .3);
  const crestFrames = performance(1).filter(frame => textureAt(frame.tick).pace > .75);
  assert.ok(calmFrames.length > 10 && crestFrames.length > 10);
  for (const part of ['bass', 'harmony', 'percussion'] as const) {
    const attacks = (frames: Frame[]) => frames.reduce((count, frame) => count + frame.notes.filter(note => note.part === part).length, 0) / frames.length;
    assert.ok(attacks(crestFrames) > attacks(calmFrames) * 1.5, `${part} must develop actual attack pace, not only louder solo notes.`);
  }
  const calmUpper = calmFrames.flatMap(frame => frame.notes.filter(note => note.id.startsWith('composed-bed:')));
  assert.ok(calmUpper.length > 10 && calmUpper.filter(note => note.articulation === 'sustained').length > calmUpper.length * .7);
  assert.ok(average(calmUpper.map(note => note.duration)) > 1000);
  for (const breadth of [0, 1]) {
    const notes = performance(breadth).flatMap(frame => frame.notes);
    assert.equal(new Set(notes.map(note => note.part)).size, 4);
    assert.ok(notes.filter(note => note.voice === 8).length > 20);
    assert.ok(notes.filter(note => note.id.startsWith('fill:')).length > 20);
    assert.ok(notes.every(note => Number.isFinite(note.velocity) && note.velocity > 0 && note.velocity <= 1));
    assert.ok(notes.some(note => note.velocity > .7));
  }
});

test('phrase shaping defers shared gain, and committed counterline and fill attacks receive it exactly once', () => {
  const layer = new PhraseLayer(seed, { ...phrasing, composition: { ...composition, cohesion: 0, accent: 0 } }, 0,
    { formAt: timeline.formAt, amount: 1, textureAt, expressionAt: tick => timeline.at(tick).expression });
  const opening = formAt(seed, 0, conductor);
  layer.begin(opening, DEFAULT_PARAMETERS);
  const probe: NoteEvent = { id: 'early-drum', tick: 0, duration: 100, part: 'percussion', voice: 9, midiNote: 36, velocity: .4 };
  assert.notEqual(ensembleDynamicGain(layer.ensembleIntensityAt(0), 1), 1);
  assert.equal(layer.shape([probe], 0, FRAME_TICKS, false).find(note => note.id === probe.id)!.velocity, probe.velocity,
    'The early phrase stage must not apply the shared gain before later instruments arrive.');

  const counter = new CounterpointLayer(seed, composition, integer(seed, 'initial', 0, 11, 'center'), tick => formAt(seed, tick, conductor));
  let checkedCounter = 0, checkedFill = 0, quietLate = 0, loudLate = 0;
  for (const frame of performance(1)) {
    const rawCounter = clipPhraseRests(counter.notes(frame.tick, frame.duration, frame.parameters, frame.sound.tuning, textureAt, frame.phrase!.themeCore), frame.phrase!.rests, Number.MAX_SAFE_INTEGER);
    const gain = ensembleDynamicGain(intensity(frame), 1);
    const check = (raw: NoteEvent) => {
      const committed = frame.notes.find(note => note.id === raw.id);
      assert.ok(committed, `Expected late orchestral attack ${raw.id}`);
      assert.equal(committed.velocity, rounded(Math.min(textureAt(raw.tick).velocityCeiling, raw.velocity * gain)), `${raw.id} receives exactly one final gain and the shared ceiling`);
      if (gain < .85) quietLate++;
      if (gain > 1.25) loudLate++;
    };
    for (const raw of rawCounter) { check(raw); checkedCounter++; }

    // Rebuild the public fill stage from its announced boundary and current
    // native bass template. No pre-shaped upper velocity or private engine
    // state is needed to check these late bass attacks independently.
    for (const fill of frame.phrase!.composition?.fills ?? []) {
      const before = formAt(seed, fill.boundaryTick - 1, conductor), after = formAt(seed, fill.boundaryTick, conductor);
      const parameters = timeline.parametersAt(Math.floor(Math.max(0, fill.boundaryTick - 3840) / FRAME_TICKS));
      const plans = planTransitions(seed, [{ id: `section-${after.sectionIndex}`, tick: fill.boundaryTick,
        themeId: before.themeId,
        kind: before.meter.numerator !== after.meter.numerator || before.meter.denominator !== after.meter.denominator ? 'meter' : 'section',
        strength: ['breakdown', 'intro'].includes(after.role) ? .45 : after.role === 'climax' ? 1 : .8 }], parameters, composition.transition);
      const p = frame.parameters;
      const bass: NoteEvent = { id: 'reference-bass', tick: frame.tick, duration: FRAME_TICKS, absolutePitch: frame.bassPitch,
        part: 'bass', voice: 4, velocity: rounded((.45 + p.dynamics * .27) * (.45 + p.dynamics * .7) * (frame.form!.beat === 1 ? 1 : .9)) };
      const templates: NoteEvent[] = frame.voicePitches.map((absolutePitch, voice) => ({ id: `reference-upper-${voice}`, tick: frame.tick,
        duration: FRAME_TICKS, absolutePitch, voice, part: 'harmony', velocity: .3 + p.dynamics * .35 }));
      const raw = realizeEnsembleFills([], { seed, tick: frame.tick, duration: FRAME_TICKS, parameters: p, tuning: frame.sound.tuning,
        additive: false, plans, templates, bassTemplate: bass, rests: frame.phrase!.rests, cohesion: composition.cohesion, textureAt }).notes;
      for (const note of raw.filter(note => note.part === 'bass')) { check(note); checkedFill++; }
    }
  }
  assert.ok(checkedCounter > 20 && checkedFill > 10);
  assert.ok(quietLate > 0 && loudLate > 10, 'Late parts receive both moderate quiet attenuation and crest gain.');
});

test('final orchestral dynamics leave actual additive pitched events and held envelopes untouched', () => {
  const engine = new MusicEngine({ seed, parameters: DEFAULT_PARAMETERS, conductor, phrasing,
    sound: { ...DEFAULT_SOUND, instrument: 'additive' } });
  const notes = Array.from({ length: 64 }, () => engine.step()).flatMap(frame => frame.notes);
  const original = structuredClone(notes);
  const quiet = applyEnsembleDynamics(notes, .05, 1, true), peak = applyEnsembleDynamics(notes, .95, 1, true);
  assert.ok(notes.filter(note => note.absolutePitch).length > 100);
  for (let i = 0; i < notes.length; i++) {
    if (notes[i].part !== 'percussion') {
      assert.strictEqual(quiet[i], notes[i]); assert.strictEqual(peak[i], notes[i]);
    } else assert.ok(peak[i].velocity > quiet[i].velocity);
    assert.ok(quiet[i].velocity > 0 && quiet[i].velocity <= 1 && peak[i].velocity > 0 && peak[i].velocity <= 1);
  }
  assert.deepEqual(notes, original, 'The dynamics pass does not mutate committed source events.');
});
