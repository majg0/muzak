import test from 'node:test';
import assert from 'node:assert/strict';
import { composeThemeCore, realizeThemeCore } from '../src/engine/theme-core';
import { PhraseLayer } from '../src/engine/phrase';
import { DEFAULT_HARMONY, type HarmonyConfig } from '../src/harmonic-language';
import { DEFAULT_PHRASING } from '../src/phrasing';
import { DEFAULT_PARAMETERS } from '../src/parameters';
import { DEFAULT_CONDUCTOR, formAt, type FormState } from '../src/conductor';
import { degreeToPitch, midiToPitch, pitchToDegree, TUNINGS, type TuningId } from '../src/pitch';
import { harmonicSequenceOffset } from '../src/engine/harmonic-tools';
import type { NoteEvent } from '../src/types';

test('generated source graphs have identifiable heads, related held goals and truthful occurrence metadata', () => {
  const subjects = new Set<string>(), contours = new Set<string>(), journeys = new Set<string>();
  for (let index = 0; index < 72; index++) {
    const core = composeThemeCore('core-' + index, 'theme-a', index % 2 ? 3 : 4);
    const head = core.clauses.filter(clause => clause.sourceId === core.headId);
    assert.equal(head.length, 1, 'A source does not force a second literal head into every argument.');
    subjects.add(JSON.stringify(head[0].notes.map(note => [note.degree, note.rhythmUnits])));
    contours.add(core.contour!); journeys.add(core.goals!.join(','));
    assert.equal(core.grammar, 'generated');
    assert.deepEqual(core.fingerprint!.intervals, head[0].notes.slice(1).map((n, i) => n.degree - head[0].notes[i].degree));
    assert.ok(core.clauses.length >= 4 && core.clauses.length <= 7);
    assert.ok(core.clauses.slice(1).every(clause => clause.parentId === core.headId && clause.relationship && Number.isInteger(clause.goalDegree)));
    const source = JSON.stringify(core);
    for (const bar of [1920, 1440, 1680]) {
      const input = { startTick: 960, endTick: 960 + bar * 8, tuning: '12tet' as const,
        occurrence: 0, cadence: 'closed' as const, treatment: 'reharmonize' as const };
      const heard = realizeThemeCore(core, input), later = realizeThemeCore(core, { ...input, occurrence: 17 });
      assert.deepEqual(heard, later);
      assert.equal(heard.notes.at(-1)!.degree, 0);
      assert.ok(heard.notes.at(-1)!.duration >= 360);
      assert.ok(heard.notes.every(note => note.tick >= 960 && note.tick + note.duration <= input.endTick));
      assert.equal(heard.realization!.motifs!.reduce((sum, motif) => sum + motif.attackCount, 0), heard.notes.length);
      assert.equal(heard.realization!.phrases!.reduce((sum, phrase) => sum + phrase.coreNotes, 0), heard.notes.length);
      for (const motif of heard.realization!.motifs!) assert.equal(
        heard.notes.filter(note => note.tick >= motif.startTick && note.tick < motif.endTick).at(-1)!.degree, motif.goalDegree);
    }
    assert.equal(JSON.stringify(core), source);
  }
  assert.ok(subjects.size > 45 && contours.size >= 5 && journeys.size > 60);
});

test('development reauthors related continuations while explicit fixed modes preserve the complete argument', () => {
  let changed = 0;
  for (let index = 0; index < 36; index++) {
    const core = composeThemeCore('core-' + index, 'theme-a', 4), input = { startTick: 0, endTick: 15360,
      tuning: '19edo' as const, occurrence: 0, cadence: 'closed' as const, treatment: 'reharmonize' as const };
    const original = realizeThemeCore(core, input);
    const developed = realizeThemeCore(core, { ...input, occurrence: 1, treatment: 'develop' });
    assert.deepEqual(original.segments[0].notes, developed.segments[0].notes);
    const signature = (line: typeof original) => line.notes.filter(n => n.coreRole !== 'head').map(n => [n.tick, n.degree]);
    if (JSON.stringify(signature(original)) !== JSON.stringify(signature(developed))) changed++;
    assert.ok(developed.realization!.motifs!.slice(1).every(motif => core.clauses.some(clause => clause.sourceId === motif.parentId)));
    assert.equal(developed.notes.at(-1)!.degree, 0);
    const open = realizeThemeCore(core, { ...input, cadence: 'open' });
    assert.ok([2, 4].includes(((open.notes.at(-1)!.degree % 7) + 7) % 7));
    assert.equal(open.notes.at(-1)!.landing, false);
    assert.deepEqual(realizeThemeCore(core, { ...input, occurrence: 99 }), original);
  }
  assert.ok(changed >= 32, changed + ' real continuations developed');
});

function layerOccurrences(tuning: TuningId, treatment: HarmonyConfig['treatment']) {
  const seed = 'thematic-invariants', harmony = { ...DEFAULT_HARMONY, treatment };
  const layer = new PhraseLayer(seed, { ...DEFAULT_PHRASING, character: 'lyrical', harmony,
    composition: { ...DEFAULT_PHRASING.composition!, embellishment: 0 } }, 0);
  const results: Array<{ notes: NoteEvent[]; snapshot: NonNullable<ReturnType<PhraseLayer['snapshot']>>;
    context: NonNullable<ReturnType<PhraseLayer['lyricalContextAt']>> }> = [];
  for (let occurrence = 0; occurrence < 4; occurrence++) {
    const start = occurrence * 15360;
    const form: FormState = { ...formAt(seed, 0, DEFAULT_CONDUCTOR), role: occurrence ? 'return' : 'theme', sectionIndex: occurrence,
      themeId: 'theme-a', sectionStartTick: start, sectionEndTick: start + 15360, phraseIndex: occurrence * 2,
      phraseStartTick: start, phraseEndTick: start + 7680, barStartTick: start, beat: 1, bar: occurrence * 8,
      barTicks: 1920, meter: { numerator: 4, denominator: 4 }, tuning, tonalOffsetCents: occurrence * 300 };
    const parameters = { ...DEFAULT_PARAMETERS, chromaticism: occurrence / 3, dissonance: occurrence / 3 };
    layer.begin(form, parameters);
    const context = layer.lyricalContextAt(start)!;
    const native = (midi: number) => degreeToPitch(tuning, pitchToDegree(tuning, midiToPitch(midi + occurrence * 2)));
    const notes: NoteEvent[] = [];
    const end = layer.snapshot()!.endTick;
    for (let tick = start; tick < end; tick += 960) {
      notes.push(...layer.shape(layer.notes(tick, 960, tuning, [55, 60, 64, 67].map(native), native(36), false), tick, 960, false));
    }
    results.push({ notes, snapshot: layer.snapshot()!, context });
  }
  return { results, harmony, seed };
}

test('actual reharmonized events preserve written tune and expose truthful degree/role links despite new chords and conductor regions', () => {
  for (const tuning of ['12tet', '19edo'] as const) {
    const { results } = layerOccurrences(tuning, 'reharmonize');
    const fingerprint = (result: typeof results[number]) => result.notes.map(note => [note.tick - result.snapshot.startTick,
      note.duration, note.absolutePitch, note.expression?.sourceId]);
    for (const result of results) {
      assert.deepEqual(fingerprint(result), fingerprint(results[0]));
      assert.equal(result.context.regionOffsetDegrees, 0);
      const snapshot = result.snapshot.themeCore!;
      assert.equal(snapshot.notes.length, result.notes.length);
      for (const note of result.notes) {
        const declared = snapshot.notes.find(source => source.startTick === note.tick && source.sourceId === note.expression?.sourceId)!;
        assert.ok(declared);
        assert.equal(Math.round(declared.absolutePitchCents * 1000), note.absolutePitch!.millicents);
        assert.equal(declared.endTick, note.tick + note.duration);
        assert.equal(degreeToPitch(tuning, pitchToDegree(tuning, note.absolutePitch!)).millicents, note.absolutePitch!.millicents);
      }
    }
  }
});

test('a sequence moves the whole native argument through the shared region cycle without refitting individual notes', () => {
  for (const tuning of ['12tet', '19edo'] as const) {
    const { results, harmony, seed } = layerOccurrences(tuning, 'sequence'), divisions = TUNINGS[tuning].divisions;
    const native = (note: NoteEvent) => tuning === '12tet' ? note.absolutePitch!.millicents / 100000 : pitchToDegree(tuning, note.absolutePitch!);
    for (const [occurrence, result] of results.entries()) {
      const expected = harmonicSequenceOffset(seed, 'theme-a', occurrence, tuning, harmony);
      assert.equal(result.context.regionOffsetDegrees, expected);
      assert.deepEqual(result.notes.map(note => note.tick - result.snapshot.startTick), results[0].notes.map(note => note.tick));
      assert.deepEqual(result.snapshot.themeCore!.notes.map(note => note.degree), results[0].snapshot.themeCore!.notes.map(note => note.degree));
      result.notes.forEach((note, index) => assert.equal(((native(note) - native(results[0].notes[index])) % divisions + divisions) % divisions, expected));
      const lastClass = ((native(result.notes.at(-1)!) % divisions) + divisions) % divisions;
      if (result.snapshot.composition!.cadence === 'closed') assert.equal(lastClass, result.context.tonic);
      else {
        assert.notEqual(lastClass, result.context.tonic, 'An inner thought keeps its open destination while the whole tune transposes.');
        const endingDegree = result.snapshot.themeCore!.notes.at(-1)!.degree;
        assert.ok([2, 4].includes(((endingDegree % 7) + 7) % 7));
      }
    }
    assert.notDeepEqual(results[0].notes.map(note => note.absolutePitch), results[1].notes.map(note => note.absolutePitch));
    assert.deepEqual(results[0].notes.map(note => note.absolutePitch), results[3].notes.map(note => note.absolutePitch));
  }
});
