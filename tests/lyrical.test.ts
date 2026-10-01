import test from 'node:test';
import assert from 'node:assert/strict';
import { planLyricalSentence } from '../src/engine/lyrical';
import { PhraseLayer } from '../src/engine/phrase';
import { lyricalField } from '../src/engine/lyrical-support';
import { DEFAULT_PARAMETERS } from '../src/parameters';
import { DEFAULT_PHRASING } from '../src/phrasing';
import { DEFAULT_CONDUCTOR, formAt, type FormState } from '../src/conductor';
import { degreeToPitch, midiToPitch, pitchToDegree, TUNINGS, type TuningId } from '../src/pitch';
import { lyricalPerformance } from '../src/lyrical';
import { createPerformance } from '../src/serialization';
import { MusicEngine } from '../src/engine';
import { FRAME_TICKS, type Frame, type NoteEvent } from '../src/types';

const sentence = (seed: string, tuning: TuningId = '12tet', cadence: 'open' | 'closed' = 'closed', occurrence = 0) => planLyricalSentence({
  seed, themeId: 'theme-a', occurrence, startTick: 0, endTick: 15360, barTicks: 1920, beatTicks: 480,
  tuning, third: 4, parameters: DEFAULT_PARAMETERS, cadence,
});
const intervals = (notes: Array<{ cents: number }>) => notes.slice(1).map((note, index) => Math.round((note.cents - notes[index].cents) * 1000) / 1000);

test('lyrical sentences recall an exact rhythmic head inside a complete directed question and answer', () => {
  const fingerprints = new Set<string>();
  let stepwiseArguments = 0;
  for (let seed = 0; seed < 40; seed++) {
    const plan = sentence(`lyrical-${seed}`), [head] = plan.segments.filter(segment => segment.sourceId === plan.headId);
    const recall = sentence('lyrical-' + seed, '12tet', 'closed', 1).segments[0];
    assert.deepEqual(intervals(head.notes), intervals(recall.notes));
    assert.deepEqual(head.notes.map(note => note.tick - head.startTick), recall.notes.map(note => note.tick - recall.startTick));
    assert.equal(plan.notes.filter(note => note.tick === plan.highPointTick).length, 1);
    const maximum = Math.max(...plan.notes.map(note => note.degree));
    assert.equal(plan.notes.find(note => note.tick === plan.highPointTick)!.degree, maximum, 'The reported upper point belongs to the actual contour.');
    const apexIndex = plan.notes.findIndex(note => note.coreRole === 'apex');
    if (apexIndex >= 0) assert.equal(plan.notes[apexIndex].degree - plan.notes[apexIndex - 1].degree, 1, 'An explicitly prepared upper goal is approached stepwise.');
    assert.equal(plan.notes.at(-1)!.degree, 0);
    assert.ok(plan.notes.at(-1)!.duration >= 360, 'The ending has time to resolve.');
    assert.ok(plan.notes.filter(note => note.duration >= 960).length >= 4, 'Long notes carry the melody.');
    const steps = plan.notes.slice(1).map((note, index) => Math.abs(note.degree - plan.notes[index].degree));
    assert.ok(steps.every(step => step <= 7), 'Every authored melodic leap stays inside an octave.');
    if (steps.some(step => step === 1)) stepwiseArguments++;
    assert.ok(Math.abs(plan.notes.at(-1)!.degree - plan.notes.at(-2)!.degree) <= 1,
      'The final arrival is prepared by a neighboring degree or a held common tone.');
    assert.ok(plan.notes.some(note => Math.floor(note.tick / 1920) !== Math.floor((note.tick + note.duration - 1) / 1920)), 'Held notes cross bar lines.');
    assert.equal(plan.rests.length, 2, 'Breaths belong to clause endings, not every cell.');
    fingerprints.add(JSON.stringify(plan.notes.map(note => [note.tick, note.degree])));
  }
  assert.ok(stepwiseArguments >= 20, 'Stepwise motion is a substantial part of the vocabulary without being mandatory in every subject.');
  assert.ok(fingerprints.size >= 15, 'Seeds select complete coherent arguments, not one shared tune.');
});

test('native lyrical fields, cadence choices and sequels preserve the composed head', () => {
  for (const tuning of Object.keys(TUNINGS) as TuningId[]) {
    const original = sentence('glass-garden', tuning), sequel = sentence('glass-garden', tuning, 'closed', 1), open = sentence('glass-garden', tuning, 'open');
    assert.deepEqual(original.segments[0].notes, sequel.segments[0].notes);
    assert.deepEqual(original.segments.filter(segment => segment.sourceId === original.headId).map(segment => segment.notes),
      sequel.segments.filter(segment => segment.sourceId === sequel.headId).map(segment => segment.notes));
    assert.ok([2, 4].includes(((open.notes.at(-1)!.degree % 7) + 7) % 7));
    assert.equal(open.notes.at(-1)!.landing, false);
    assert.equal(original.notes.at(-1)!.landing, true);
    for (const note of original.notes) {
      const degree = note.cents * TUNINGS[tuning].divisions / 1200;
      assert.ok(Math.abs(degree - Math.round(degree)) < .00003);
      assert.ok(lyricalField(tuning, 4).includes(((Math.round(degree) % TUNINGS[tuning].divisions) + TUNINGS[tuning].divisions) % TUNINGS[tuning].divisions));
      assert.ok(Number.isSafeInteger(note.tick) && Number.isSafeInteger(note.duration) && note.duration > 0);
    }
    assert.deepEqual(original, sentence('glass-garden', tuning));
  }
});

function renderedLayer(tuning: TuningId, harmonyShift = 0) {
  const seed = 'glass-garden', layer = new PhraseLayer(seed, { ...DEFAULT_PHRASING, character: 'lyrical' }, 0);
  const form: FormState = { ...formAt(seed, 0, DEFAULT_CONDUCTOR), role: 'theme', sectionIndex: 0,
    themeId: 'theme-a', sectionStartTick: 0, sectionEndTick: 15360, phraseIndex: 0, phraseStartTick: 0, phraseEndTick: 7680,
    barStartTick: 0, beat: 1, bar: 0, barTicks: 1920, meter: { numerator: 4, denominator: 4 }, tuning, tonalOffsetCents: 0,
    behavior: { ...formAt(seed, 0, DEFAULT_CONDUCTOR).behavior!, ending: 'closed' } };
  layer.begin(form, DEFAULT_PARAMETERS);
  let before = layer.snapshot()!;
  while (before.endTick < form.sectionEndTick) {
    const start = before.endTick;
    layer.begin({ ...form, phraseStartTick: start, phraseEndTick: form.sectionEndTick, barStartTick: start, beat: 1 }, DEFAULT_PARAMETERS);
    before = layer.snapshot()!;
    assert.equal(before.startTick, start);
  }
  const notes: NoteEvent[] = [];
  const native = (midi: number) => degreeToPitch(tuning, pitchToDegree(tuning, midiToPitch(midi + harmonyShift)));
  for (let tick = before.startTick; tick < before.endTick; tick += 960) {
    const events = layer.notes(tick, 960, tuning, [55, 60, 64, 67].map(native), native(36), false);
    notes.push(...layer.shape(events, tick, 960, false));
  }
  return { layer, notes, snapshot: layer.snapshot()! };
}

test('the emitted sentence owns its pitch contour across changing backing and exposes truthful native hierarchy', () => {
  for (const tuning of Object.keys(TUNINGS) as TuningId[]) {
    const { layer, notes, snapshot } = renderedLayer(tuning), other = renderedLayer(tuning, 5);
    assert.ok(snapshot.endTick - snapshot.startTick >= 4 * FRAME_TICKS && snapshot.startTick > 0);
    assert.equal(snapshot.endTick, 15360);
    assert.equal(snapshot.composition!.cadence, 'closed');
    assert.equal(snapshot.cells.length, snapshot.composition!.motifs.length,
      'The emitted cells describe exactly the active source gestures in this thought.');
    assert.ok(snapshot.cells.some(cell => cell.label.startsWith('Question')) && snapshot.cells.some(cell => cell.label.startsWith('Answer')));
    assert.equal(snapshot.composition!.motifs.length, snapshot.themeCore!.realization!.motifs!.length);
    assert.deepEqual(notes.map(note => [note.tick, note.absolutePitch]), other.notes.map(note => [note.tick, note.absolutePitch]), 'Backing cannot reroll a protected complete tune.');
    assert.equal(notes.filter(note => note.expression?.role === 'anchor').length, snapshot.composition!.shortPhrases!.reduce((sum, clause) => sum + clause.coreNotes, 0));
    assert.ok(notes.every(note => note.voice === 5));
    assert.equal(new Set(notes.map(note => note.timbre)).size, 1, 'A complete source has one instrumental identity.');
    assert.ok(notes.filter(note => note.expression?.role === 'anchor').at(-1)!.duration >= 360,
      'The final destination remains held within the shorter complete thought.');
    assert.ok(notes.every(note => degreeToPitch(tuning, pitchToDegree(tuning, note.absolutePitch!)).millicents === note.absolutePitch!.millicents));
    assert.deepEqual(notes.at(-1)!.absolutePitch, degreeToPitch(tuning, pitchToDegree(tuning, midiToPitch(60))), 'The authored final tonic must not be snapped to a different harmonic guide.');
    const [first] = snapshot.composition!.shortPhrases!.filter(cell => cell.sourceId === snapshot.themeCore!.headId);
    const fingerprint = (cell: typeof first) => notes.filter(note => note.tick >= cell.startTick && note.tick < cell.endTick && note.expression?.role === 'anchor')
      .map(note => [note.tick - cell.startTick, note.absolutePitch!.millicents, note.expression!.sourceId]);
    assert.deepEqual(fingerprint(first), snapshot.themeCore!.notes.filter(note => note.role === 'head')
      .map(note => [note.startTick - first.startTick, Math.round(note.absolutePitchCents * 1000), note.sourceId]));
    for (const rest of snapshot.rests) assert.ok(notes.every(note => note.tick >= rest.endTick || note.tick + note.duration <= rest.startTick));
    assert.ok(notes.slice(1).filter((note, index) => notes[index].tick + notes[index].duration >= note.tick).length >= notes.length - 3);
    const targets = layer.harmonicTargets(snapshot.startTick, snapshot.endTick - snapshot.startTick);
    assert.ok(targets.length >= 2 && targets.every(cents => notes.some(note => note.absolutePitch!.millicents === Math.round(cents * 1000))));
    assert.ok(snapshot.ideas.length > 0 && snapshot.ideas[0].lineage?.includes(tuning));
  }
});

test('one thematic performance replays complete frames and old character flags cannot select another foreground', () => {
  const recipe = lyricalPerformance(createPerformance('glass-garden')).recipe;
  const a = new MusicEngine({ ...recipe, parameters: recipe.initialParameters }), b = new MusicEngine({ ...recipe, parameters: recipe.initialParameters }), frames: Frame[] = [];
  for (let i = 0; i < 64; i++) { const frame = a.step(); assert.deepEqual(frame, b.step()); frames.push(frame); }
  assert.ok(frames.some(frame => frame.phrase?.cells.some(cell => cell.label.startsWith('Answer'))));
  assert.ok(frames.every(frame => frame.phrase?.themeCore));
  assert.ok(frames.flatMap(frame => frame.notes).filter(note => note.id.startsWith('phrase:')).every(note => note.voice === 5));
  const legacy = createPerformance('legacy-character'), explicit = structuredClone(legacy);
  explicit.phrasing = { ...explicit.phrasing!, character: 'exploratory' };
  const oldEngine = new MusicEngine({ ...legacy, parameters: legacy.initialParameters }), explicitEngine = new MusicEngine({ ...explicit, parameters: explicit.initialParameters });
  for (let i = 0; i < 24; i++) assert.deepEqual(oldEngine.step(), explicitEngine.step());
});
