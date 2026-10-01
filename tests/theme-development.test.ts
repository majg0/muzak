import test from 'node:test';
import assert from 'node:assert/strict';
import { composeThemeCore, realizeThemeCore, themeDevelopment, themeThird } from '../src/engine/theme-core';
import { PhraseLayer, seedIdea } from '../src/engine/phrase';
import { DEFAULT_PARAMETERS } from '../src/parameters';
import { DEFAULT_PHRASING } from '../src/phrasing';
import { DEFAULT_COMPOSITION } from '../src/composition';
import { DEFAULT_HARMONY } from '../src/harmonic-language';
import { DEFAULT_CONDUCTOR, formAt, type FormState } from '../src/conductor';
import { midiToPitch, TUNINGS } from '../src/pitch';
import { FRAME_TICKS, type Parameters } from '../src/types';

const controls = (patch: Partial<Parameters> = {}) => ({ ...DEFAULT_PARAMETERS, motifRecurrence: 0,
  motifTransformation: 1, melodicFamiliarity: 0, ...patch });

test('ordinary recurrence develops heard material while explicit literal recurrence remains available', () => {
  let copies = 0, developed = 0, changedStructuralNotes = 0;
  for (let index = 0; index < 32; index++) {
    const seed = 'ordinary-development-' + index, core = composeThemeCore(seed, 'theme-a', 4);
    const input = { startTick: 0, endTick: 15360, tuning: '12tet' as const,
      occurrence: 0, cadence: 'closed' as const, treatment: 'develop' as const };
    const first = realizeThemeCore(core, { ...input,
      development: themeDevelopment(seed, 'theme-a', 0, false, DEFAULT_PARAMETERS) });
    const signature = (line: typeof first) => JSON.stringify(line.notes.map(n => [n.tick, n.degree, n.duration]));
    for (let occurrence = 1; occurrence <= 8; occurrence++) {
      const line = realizeThemeCore(core, { ...input, occurrence,
        development: themeDevelopment(seed, 'theme-a', occurrence, true, DEFAULT_PARAMETERS) });
      assert.deepEqual(line.segments[0].notes, first.segments[0].notes);
      if (signature(line) === signature(first)) copies++; else {
        developed++;
        changedStructuralNotes += line.notes.filter((n, i) => !first.notes[i]
          || n.degree !== first.notes[i].degree || n.tick !== first.notes[i].tick).length;
      }
    }
    const returned = composeThemeCore(seed, 'theme-a', 4);
    returned.clauses[0].notes[0].degree = 99;
    assert.notEqual(composeThemeCore(seed, 'theme-a', 4).clauses[0].notes[0].degree, 99,
      'Cached source graphs cannot be mutated by callers.');
  }
  assert.ok(copies < 40 && developed > 216, copies + ' literal copies and ' + developed + ' developed returns');
  assert.ok(changedStructuralNotes > developed * 4, 'Development changes substantial continuation material.');
});

test('recurrence selects actual literal returns while first or unheard statements keep their original argument', () => {
  let developments = 0;
  for (let index = 0; index < 64; index++) {
    const seed = `recall-policy-${index}`, core = composeThemeCore(seed, 'theme-a', 4);
    const input = { startTick: 0, endTick: 15360, tuning: '12tet' as const, occurrence: 2,
      cadence: 'closed' as const, treatment: 'develop' as const };
    const original = realizeThemeCore(core, { ...input, treatment: 'reharmonize' });
    const run = (p: Parameters, heard = true, occurrence = 2) => realizeThemeCore(core,
      { ...input, occurrence, development: themeDevelopment(seed, 'theme-a', occurrence, heard, p) });
    assert.deepEqual(run(controls({ motifRecurrence: 1 })), original);
    assert.deepEqual(run(controls({ motifTransformation: 0 })), original);
    assert.deepEqual(run(controls(), false), original, 'A planned source cannot be called a remembered return before it sounds.');
    assert.deepEqual(run(controls(), true, 0), original, 'The first statement always establishes the source.');
    const developed = run(controls());
    if (developed.notes.some((note, i) => note.degree !== original.notes[i]?.degree)) developments++;
    assert.deepEqual(developed, run(controls()));
  }
  assert.ok(developments >= 48, `${developments} bounded continuations actually developed`);
});

test('familiarity bounds goal departure and transformation develops whole continuations on native grids', () => {
  let familiarDistance = 0, freeDistance = 0, smallDistance = 0, changedNotes = 0;
  for (const tuning of Object.keys(TUNINGS) as Array<keyof typeof TUNINGS>) for (let index = 0; index < 32; index++) {
    const seed = 'continuation-policy-' + index, core = composeThemeCore(seed, 'theme-a', 4);
    const input = { startTick: 0, endTick: 15360, tuning, occurrence: 3, cadence: 'closed' as const, treatment: 'develop' as const };
    const source = realizeThemeCore(core, { ...input, treatment: 'reharmonize' });
    const realize = (p: Parameters) => realizeThemeCore(core, { ...input, development: themeDevelopment(seed, 'theme-a', 3, true, p) });
    const familiar = realize(controls({ melodicFamiliarity: 1 })), free = realize(controls()), small = realize(controls({ motifTransformation: .2 }));
    const distance = (plan: typeof source) => plan.realization!.motifs!.slice(1, -1).reduce((sum, motif) => sum
      + Math.abs(motif.goalDegree - core.clauses.find(clause => clause.sourceId === motif.parentId)!.goalDegree!), 0);
    familiarDistance += distance(familiar); freeDistance += distance(free); smallDistance += distance(small);
    changedNotes += free.notes.filter((note, i) => !source.notes[i] || note.degree !== source.notes[i].degree || note.tick !== source.notes[i].tick).length;
    for (const plan of [familiar, free, small]) {
      assert.deepEqual(plan.segments[0].notes, source.segments[0].notes);
      assert.equal(plan.notes.at(-1)!.degree, 0);
      assert.ok(plan.notes.every((note, i) => !i || Math.abs(note.degree - plan.notes[i - 1].degree) <= 7));
      assert.ok(plan.realization!.motifs!.slice(1).every(motif => core.clauses.some(clause => clause.sourceId === motif.parentId)));
      for (const note of plan.notes) {
        const native = note.cents * TUNINGS[tuning].divisions / 1200;
        assert.ok(Math.abs(native - Math.round(native)) < .00003);
      }
    }
  }
  assert.ok(freeDistance > familiarDistance * 1.5 && freeDistance > smallDistance * 1.5);
  assert.ok(changedNotes > 600, 'Development changes complete related continuations rather than one or two notes.');
});

function form(seed: string, start: number): FormState {
  return { ...formAt(seed, start, DEFAULT_CONDUCTOR), role: 'theme', themeId: 'theme-a', sectionIndex: 0,
    sectionStartTick: 0, sectionEndTick: 61440, phraseIndex: Math.floor(start / 7680), phraseStartTick: start,
    phraseEndTick: start + 7680, barStartTick: start, beat: 1, bar: Math.floor(start / 1920), barTicks: 1920,
    meter: { numerator: 4, denominator: 4 }, tuning: '12tet' };
}

test('new argument controls cannot rewrite the playing thought or an explicitly fixed melody', () => {
  const seed = 'glass-garden';
  const run = (treatment: 'develop' | 'reharmonize' | 'sequence', p: Parameters) => {
    const layer = new PhraseLayer(seed, { ...DEFAULT_PHRASING,
      composition: { ...DEFAULT_COMPOSITION, embellishment: 0 }, harmony: { ...DEFAULT_HARMONY, treatment } }, 0);
    layer.begin(form(seed, 0), controls());
    const first = layer.snapshot()!;
    layer.shape(layer.notes(0, first.endTick, '12tet', [55, 60, 64, 67].map(midiToPitch), midiToPitch(36), false), 0, first.endTick, false);
    const playing = layer.snapshot();
    layer.begin(form(seed, first.startTick + FRAME_TICKS), p);
    assert.deepEqual(layer.snapshot(), playing, 'A live edit waits for the next authored argument.');
    layer.begin(form(seed, first.endTick), p);
    const next = layer.snapshot()!;
    const notes = layer.notes(first.endTick, next.endTick - first.endTick, '12tet', [56, 61, 65, 68].map(midiToPitch), midiToPitch(37), false);
    return { first, next, notes };
  };
  const literal = run('develop', controls({ motifRecurrence: 1 })), free = run('develop', controls());
  assert.deepEqual(literal.first.themeCore, free.first.themeCore);
  assert.notDeepEqual(literal.next.themeCore!.notes.map(note => note.degree), free.next.themeCore!.notes.map(note => note.degree));
  const protectedNotes = (result: typeof free) => result.next.themeCore!.notes.filter(note => note.role === 'head')
    .map(note => [note.startTick, note.degree, note.sourceId]);
  assert.deepEqual(protectedNotes(literal), protectedNotes(free));
  for (const treatment of ['reharmonize', 'sequence'] as const) {
    const a = run(treatment, controls()), b = run(treatment, controls({ motifRecurrence: 1, melodicFamiliarity: 1, motifTransformation: 0 }));
    assert.deepEqual(a.next.themeCore, b.next.themeCore);
    assert.deepEqual(a.notes, b.notes, 'The explicit melody policy overrides developmental macro freedom.');
  }
});

test('the common modal helper gives source themes and their quotations the same third', () => {
  for (let index = 0; index < 50; index++) for (const family of ['theme-a', 'theme-b', 'theme-c', 'theme-d']) {
    const seed = `modal-identity-${index}`;
    assert.equal(themeThird(seed, family), seedIdea(seed, family).third);
    assert.notEqual(themeThird(seed, 'theme-a'), themeThird(seed, 'theme-b'));
  }
});

test('strong developmental expression can move the performed argument into another register without rewriting its identity', () => {
  const p = controls();
  const run = (register: number, treatment: 'develop' | 'reharmonize' = 'develop', seed = 'amber-current') => {
    const layer = new PhraseLayer(seed, { ...DEFAULT_PHRASING,
      composition: { ...DEFAULT_COMPOSITION, embellishment: 0 }, harmony: { ...DEFAULT_HARMONY, treatment } }, 0,
    { amount: 1, formAt: tick => form(seed, tick), expressionAt: () => ({ energy: .8, activity: .8, intensity: .8,
      register, sustain: .6, accent: .8, direction: 'cresting' }) });
    layer.begin(form(seed, 0), p);
    const first = layer.snapshot()!;
    const heard = layer.notes(0, first.endTick, '12tet', [55, 60, 64, 67].map(midiToPitch), midiToPitch(36), false);
    layer.shape(heard, 0, first.endTick, false);
    layer.begin(form(seed, first.endTick), p);
    const next = layer.snapshot()!;
    const notes = layer.notes(first.endTick, next.endTick - first.endTick, '12tet', [55, 60, 64, 67].map(midiToPitch), midiToPitch(36), false);
    return { first, next, heard, notes };
  };
  let shifted = 0, held = 0;
  for (let index = 0; index < 32; index++) {
    const seed = `register-gesture-${index}`, calm = run(.2, 'develop', seed), crest = run(.84, 'develop', seed);
    assert.deepEqual(calm.first.themeCore, crest.first.themeCore, 'First exposition establishes its stable register.');
    assert.deepEqual(calm.notes.map(note => [note.tick, note.expression!.sourceId]), crest.notes.map(note => [note.tick, note.expression!.sourceId]));
    assert.ok(crest.notes.length && calm.notes.length);
    const delta = crest.notes[0].absolutePitch!.millicents - calm.notes[0].absolutePitch!.millicents;
    assert.ok(delta === 0 || delta === 1200000);
    assert.ok(crest.notes.every((note, i) => note.absolutePitch!.millicents - calm.notes[i].absolutePitch!.millicents === delta));
    assert.ok(crest.notes.every(note => note.absolutePitch!.millicents >= 5200000 && note.absolutePitch!.millicents <= 9600000));
    if (delta) shifted++; else held++;
    assert.deepEqual(run(.2, 'reharmonize', seed).next.themeCore, run(.84, 'reharmonize', seed).next.themeCore);
  }
  assert.ok(shifted >= 4 && held >= 4, `${shifted} reachable registral answers, ${held} statements retained by range/continuity`);
});
