import test from 'node:test';
import assert from 'node:assert/strict';
import { composeThemeCore, realizeThemeCore } from '../src/engine/theme-core';
import { realizeThemeDelivery } from '../src/engine/theme-realization';
import { PhraseLayer } from '../src/engine/phrase';
import { DEFAULT_CONDUCTOR, formAt, type FormState } from '../src/conductor';
import { DEFAULT_PARAMETERS } from '../src/parameters';
import { DEFAULT_PHRASING } from '../src/phrasing';
import { DEFAULT_HARMONY } from '../src/harmonic-language';
import { DEFAULT_COMPOSITION } from '../src/composition';
import { degreeToPitch, midiToPitch, pitchToDegree, TUNINGS } from '../src/pitch';
import type { ExpressiveContour } from '../src/engine/expression';
import type { TextureIntent } from '../src/engine/texture';
import type { LyricalSentence } from '../src/engine/lyrical';

const texture = (pace: number): TextureIntent => ({ pace, syncopation: pace, subdivisionTicks: pace < .3 ? 480 : pace < .78 ? 240 : 120,
  gateRatio: 1.2, attackSoftness: 1 - pace, rhythmDrive: pace, velocityCeiling: .95,
  articulation: pace < .3 ? 'sustained' : 'connected' });
const expression = (value: number): ExpressiveContour => ({ energy: value, activity: value, intensity: value,
  register: .5, sustain: 1 - value, accent: value, direction: 'settled' });

test('shared texture admits economical native-scale delivery while preserving every thematic anchor', () => {
  let ornaments = 0, changedBodies = 0;
  const kinds = new Set<string>();
  for (const tuning of ['12tet', '19edo'] as const) for (let index = 0; index < 36; index++) {
    const seed = `delivery-${index}`, sentence = realizeThemeCore(composeThemeCore(seed, 'theme-a', 4), {
      startTick: 0, endTick: 15360, tuning, occurrence: 0, cadence: 'closed', treatment: 'reharmonize' });
    const original = structuredClone(sentence);
    const run = (pace: number, embellishment = 1) => realizeThemeDelivery(sentence, { seed, occurrence: 0, tuning, third: 4,
      embellishment, textureAt: () => texture(pace) });
    const calm = run(.1), crest = run(.95);
    assert.equal(calm.ornamentCount, 0);
    assert.equal(run(.95, 0).ornamentCount, 0);
    assert.deepEqual(crest, run(.95), 'Delivery is a deterministic realization of the source.');
    assert.deepEqual(sentence, original, 'Realization never edits the remembered source.');
    assert.deepEqual(crest.anchors.map(note => [note.tick, note.cents, note.sourceId]),
      sentence.notes.map(note => [note.tick, note.cents, note.sourceId]));
    for (const [ordinal, note] of crest.anchors.entries()) {
      if (['head', 'apex', 'cadence'].includes(note.coreRole!)) assert.equal(note.duration, sentence.notes[ordinal].duration);
      else if (note.duration !== sentence.notes[ordinal].duration) changedBodies++;
      assert.ok(note.duration > 0 && note.duration <= sentence.notes[ordinal].duration);
    }
    for (const note of crest.segments.flatMap(segment => segment.notes).filter(note => !note.core)) {
      ornaments++;
      const owner = sentence.notes.find(anchor => note.sourceId.startsWith(`${anchor.sourceId}:ornament:`))!;
      const next = sentence.notes.find(anchor => anchor.tick > owner.tick)!;
      assert.ok(owner && next && note.tick > owner.tick && note.tick < next.tick);
      assert.ok(note.tick + note.duration <= next.tick + 24);
      assert.ok(note.accent < owner.accent);
      assert.ok(!sentence.rests.some(rest => note.tick < rest.endTick && note.tick + note.duration > rest.startTick));
      assert.ok(Math.abs(note.cents * TUNINGS[tuning].divisions / 1200 - Math.round(note.cents * TUNINGS[tuning].divisions / 1200)) < .00002);
      kinds.add(note.sourceId.split(':ornament:')[1].split(':')[0]);
    }
    assert.ok(crest.ornamentCount < sentence.notes.length, 'A crest still exposes the tune rather than replacing it with runs.');
  }
  assert.ok(ornaments >= 140 && changedBodies >= 70, `${ornaments} actual ornaments in ${changedBodies} eligible held bodies`);
  assert.ok(kinds.size >= 8 && kinds.has('turn') && kinds.has('enclosure'), `Actual ornament vocabulary: ${[...kinds]}`);
});

test('the mandatory foreground uses the common expression for its envelopes and connected native delivery', () => {
  for (const tuning of ['12tet', '19edo'] as const) for (const seed of ['glass-garden', 'amber-current']) {
    const form: FormState = { ...formAt(seed, 0, DEFAULT_CONDUCTOR), role: 'theme', themeId: 'theme-a', sectionIndex: 0,
      sectionStartTick: 0, sectionEndTick: 15360, phraseIndex: 0, phraseStartTick: 0, phraseEndTick: 7680,
      barStartTick: 0, beat: 1, bar: 0, barTicks: 1920, meter: { numerator: 4, denominator: 4 }, tuning };
    const run = (pace: number) => {
      const layer = new PhraseLayer(seed, { ...DEFAULT_PHRASING, enabled: false, character: 'exploratory',
        harmony: { ...DEFAULT_HARMONY, treatment: 'reharmonize' }, composition: { ...DEFAULT_COMPOSITION, embellishment: 1 } }, 0,
      { formAt: () => form, amount: 1, expressionAt: () => expression(pace), textureAt: () => texture(pace) });
      layer.begin(form, DEFAULT_PARAMETERS);
      const snapshot = layer.snapshot()!, notes = layer.notes(0, snapshot.endTick, tuning, [55, 60, 64, 67].map(midiToPitch), midiToPitch(36), false);
      return { snapshot, notes };
    };
    const calm = run(.1), active = run(.95);
    assert.ok(calm.snapshot.themeCore && active.snapshot.themeCore, 'Old flags cannot select a second foreground generator.');
    const identity = (run: typeof calm) => run.notes.filter(note => note.expression?.role === 'anchor')
      .map(note => [note.tick, note.absolutePitch, note.expression?.sourceId]);
    assert.deepEqual(identity(calm), identity(active));
    assert.equal(new Set(calm.notes.map(note => note.timbre)).size, 1, 'One source selects a coherent instrumental color.');
    assert.equal(new Set(active.notes.map(note => note.timbre)).size, 1);
    assert.ok(calm.notes.filter(note => note.expression?.role === 'anchor' && note.duration >= 720)
      .every(note => note.articulation === 'sustained'));
    assert.ok(active.notes.filter(note => note.expression?.role === 'anchor' && note.duration < 720)
      .every(note => note.articulation === 'connected'));
    for (const note of active.notes.filter(note => note.articulation === 'detached')) {
      assert.equal(note.expression?.role, 'ornament');
      assert.ok(note.expression?.sourceId?.includes(':ornament:accented-repetition:'));
    }
    assert.ok(active.notes.length > calm.notes.length);
    for (const run of [calm, active]) {
      for (const envelope of run.snapshot.envelopes) {
        assert.equal(envelope.spread, 0);
        assert.deepEqual(envelope.points, envelope.realized);
        assert.ok(envelope.points.every(point => point.value === (envelope.key === 'register' ? .5 : run === calm ? .1 : .95)));
      }
      for (const declared of run.snapshot.themeCore!.notes) {
        const note = run.notes.find(note => note.tick === declared.startTick && note.expression?.sourceId === declared.sourceId)!;
        assert.equal(note.absolutePitch!.millicents, Math.round(declared.absolutePitchCents * 1000));
        assert.equal(note.tick + note.duration, declared.endTick);
      }
      for (const note of run.notes) assert.deepEqual(note.absolutePitch, degreeToPitch(tuning, pitchToDegree(tuning, note.absolutePitch!)));
    }
  }
});

test('native ornamental delivery labels cross-octave neighbors without changing their physical pitches', () => {
  const seed = 'boundary-35';
  const notes: LyricalSentence['notes'] = [0, 5, 16, 19, 11, 0].map((degree, index) => ({ tick: index * 960, duration: 960,
    cents: degree * 1200 / 19, degree: [0, 2, 6, 7, 4, 0][index], accent: .9, landing: index === 5,
    protectedTheme: true, function: 'development', sourceId: `boundary:${index}`,
    coreRole: index === 0 ? 'head' : index === 5 ? 'cadence' : 'continuation' }));
  const sentence: LyricalSentence = { notes, headId: 'boundary', highPointTick: 2880, rests: [],
    segments: [{ startTick: 0, endTick: 5760, label: 'Crossing the octave', role: 'answer', sourceId: 'boundary', notes }] };
  // The physical figure is reached through its long-form opportunity, rather
  // than requiring a particular seed to win a uniform vocabulary draw.
  const deliveries = Array.from({ length: 36 }, (_, occurrence) => realizeThemeDelivery(sentence, { seed, occurrence,
    tuning: '19edo', third: 3, embellishment: 1,
    parameters: { ...DEFAULT_PARAMETERS, chromaticism: 1 }, textureAt: () => texture(.8) }));
  const written = deliveries.flatMap(delivery => delivery.segments.flatMap(segment => segment.notes));
  const neighbor = written
    .find(note => !note.core && Math.abs(note.cents - 18 * 1200 / 19) < 1e-9);
  assert.ok(neighbor, 'The chromatic enclosure retains its actual native pitch below the next tonic.');
  assert.equal(neighbor.degree, 7, 'The closest scale position lies in the next octave.');
  assert.ok(deliveries.every(delivery => delivery.anchors.at(-1)!.degree === 0), 'Decoration preserves the structural cadence.');
  const repeated = written.filter(note => !note.core && note.sourceId.includes(':ornament:accented-repetition:'));
  assert.ok(repeated.length > 0, 'An explicitly planned repetition reaches the actual theme delivery.');
  assert.ok(repeated.every(note => note.articulation === 'detached' && note.duration < 120));
});
