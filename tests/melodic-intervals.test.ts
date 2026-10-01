import test from 'node:test';
import assert from 'node:assert/strict';
import { composeThemeCore, realizeThemeCore } from '../src/engine/theme-core';
import { PhraseLayer } from '../src/engine/phrase';
import { DEFAULT_PARAMETERS } from '../src/parameters';
import { DEFAULT_PHRASING } from '../src/phrasing';
import { DEFAULT_HARMONY } from '../src/harmonic-language';
import { DEFAULT_COMPOSITION } from '../src/composition';
import { DEFAULT_CONDUCTOR, formAt } from '../src/conductor';
import { TUNINGS, degreeToPitch, pitchToDegree, midiToPitch, type TuningId } from '../src/pitch';

test('the subject vocabulary names intervals with field landings, rhythmic identity and measured recovery', () => {
  const sizes = new Set<number>(), patterns = new Set<string>();
  let restrained = 0, delayedRecovery = 0, echoes = 0;
  for (let index = 0; index < 160; index++) {
    const core = composeThemeCore(`interval-subject-${index}`, 'theme-a', 4), heads = core.clauses.filter(clause => clause.sourceId === core.headId);
    assert.deepEqual(heads[0].notes.map(note => note.rhythmUnits), core.fingerprint!.rhythmUnits);
    const notes = heads[0].notes, intervals = notes.slice(1).map((note, i) => note.degree - notes[i].degree);
    patterns.add(notes.map(note => `${note.degree}:${note.rhythmUnits}`).join(','));
    const signature = intervals.findIndex(interval => Math.abs(interval) === Math.max(...intervals.map(Math.abs)));
    if (Math.abs(intervals[signature]) <= 1) { restrained++; continue; }
    sizes.add(Math.abs(intervals[signature]));
    const landing = notes[signature + 1];
    if (Math.abs(intervals[signature]) >= 3) assert.ok([0, 2, 4].includes(((landing.degree % 7) + 7) % 7), 'The signature reaches a stable member of the declared native field.');
    if (Math.abs(intervals[signature]) >= 3) assert.ok(landing.rhythmUnits >= 2, 'A wide identifying landing has written weight.');
    const recovery = intervals.slice(signature + 1);
    assert.ok(recovery.every(interval => Math.abs(interval) <= 2));
    if (recovery[0] * intervals[signature] > 0) delayedRecovery++;
    if (intervals.includes(0)) echoes++;
  }
  assert.deepEqual(sizes, new Set([2, 3, 4, 5, 6, 7]));
  assert.ok(restrained >= 8 && patterns.size >= 100,
    `${restrained} restrained, ${delayedRecovery} continuing after reach, ${echoes} echoes, ${patterns.size} subjects`);
});

test('interval intent controls continuation breadth without rewriting the protected identifying head', () => {
  let restrainedLarge = 0, broadLarge = 0, large = 0, recovered = 0;
  for (let index = 0; index < 64; index++) {
    const seed = `interval-intent-${index}`, core = composeThemeCore(seed, 'theme-a', 4);
    const run = (intervalComplexity: number, familiarity: number) => realizeThemeCore(core, {
      startTick: 0, endTick: 15360, tuning: '12tet', occurrence: 0, cadence: 'closed', treatment: 'reharmonize',
      argument: { seed, ideaDensity: 1, activity: .8, register: .5, intervalComplexity, familiarity } });
    const low = run(0, 1), high = run(1, 0);
    assert.deepEqual(low.segments[0].notes, high.segments[0].notes);
    for (const [which, line] of [low, high].entries()) {
      assert.equal(line.notes.at(-1)!.degree, 0);
      assert.ok(line.notes.at(-1)!.duration >= 600);
      for (let i = 1; i < line.notes.length; i++) {
        const note = line.notes[i], distance = Math.abs(note.cents - line.notes[i - 1].cents);
        assert.ok(distance <= 1200.001);
        if (distance <= 500 || note.coreRole === 'head') continue;
        if (which) broadLarge++; else restrainedLarge++;
        large++;
        if (note.duration >= 240 || line.notes.slice(i + 1, i + 3).some((next, j) => Math.abs(next.cents - line.notes[i + j].cents) <= 400)) recovered++;
      }
    }
  }
  assert.ok(broadLarge > restrainedLarge * 1.4 && broadLarge >= 100, `${broadLarge} broad versus ${restrainedLarge} restrained continuation leaps`);
  assert.ok(recovered / large >= .97, `${recovered}/${large} wide transfers have a held landing or a short recovery`);
});

test('the performed native line exposes steps, skips and large intervals while preserving its source and physical bounds', () => {
  const intervals = new Set<number>();
  let total = 0, small = 0, leaps = 0, large = 0, repeats = 0;
  for (const tuning of Object.keys(TUNINGS) as TuningId[]) for (let index = 0; index < 32; index++) for (const density of [0, .5, 1]) {
    const seed = `performed-interval-${index}`, initial = formAt(seed, 0, DEFAULT_CONDUCTOR, tuning);
    const form = { ...initial, tuning, role: 'theme' as const, themeId: 'theme-a', sectionIndex: 0, sectionStartTick: 0, sectionEndTick: 61440,
      phraseStartTick: 0, phraseEndTick: 7680, barStartTick: 0, barTicks: 1920, beat: 1, meter: { numerator: 4, denominator: 4 as const } };
    const layer = new PhraseLayer(seed, { ...DEFAULT_PHRASING, harmony: { ...DEFAULT_HARMONY, treatment: 'reharmonize' },
      composition: { ...DEFAULT_COMPOSITION, embellishment: 0 } }, index % 12);
    layer.begin(form, { ...DEFAULT_PARAMETERS, ideaDensity: density, intervalComplexity: .8 });
    const snapshot = layer.snapshot()!, notes = layer.notes(0, snapshot.endTick, tuning, [55, 60, 64, 67].map(midiToPitch), midiToPitch(36), false);
    assert.equal(notes.length, snapshot.themeCore!.notes.length);
    for (const [i, note] of notes.entries()) {
      assert.equal(note.absolutePitch!.millicents, Math.round(snapshot.themeCore!.notes[i].absolutePitchCents * 1000));
      assert.ok(note.absolutePitch!.millicents >= 5200000 && note.absolutePitch!.millicents <= 9600000);
      assert.deepEqual(note.absolutePitch, degreeToPitch(tuning, pitchToDegree(tuning, note.absolutePitch!)));
      if (!i) continue;
      const cents = Math.abs(note.absolutePitch!.millicents - notes[i - 1].absolutePitch!.millicents) / 1000;
      assert.ok(cents <= 1200.001);
      total++;
      if (cents < 1) repeats++; else if (cents <= 250) small++; else if (cents <= 500) leaps++; else large++;
      if (tuning === '12tet') intervals.add(Math.round(cents));
    }
  }
  for (const interval of [300, 400, 500, 700, 900, 1100, 1200]) assert.ok(intervals.has(interval), `Missing emitted interval ${interval} cents`);
  assert.ok(large / total > .06 && large / total < .3, `${large}/${total} large intervals`);
  assert.ok(small / total > .25 && leaps / total > .1 && repeats > 100, 'Step motion, skips, repeats and wide gestures retain distinct musical jobs.');
});

test('range-limited ornaments cannot move a protected thematic argument into another octave', () => {
  for (const tuning of Object.keys(TUNINGS) as TuningId[]) for (const [ordinal, density] of [[39, 1], [49, .5]]) {
    const seed = `register-review-${ordinal}`, initial = formAt(seed, 0, DEFAULT_CONDUCTOR, tuning);
    const form = { ...initial, tuning, role: 'theme' as const, themeId: 'theme-a', sectionIndex: 0, sectionStartTick: 0, sectionEndTick: 61440,
      phraseStartTick: 0, phraseEndTick: 7680, barStartTick: 0, barTicks: 1920, beat: 1, meter: { numerator: 4, denominator: 4 as const } };
    const run = (embellishment: number) => {
      const layer = new PhraseLayer(seed, { ...DEFAULT_PHRASING, harmony: { ...DEFAULT_HARMONY, treatment: 'reharmonize' },
        composition: { ...DEFAULT_COMPOSITION, embellishment } }, ordinal % 12);
      layer.begin(form, { ...DEFAULT_PARAMETERS, ideaDensity: density, melodicActivity: .8, intervalComplexity: .9 });
      const snapshot = layer.snapshot()!, notes = layer.notes(0, snapshot.endTick, tuning,
        [55, 60, 64, 67].map(midiToPitch), midiToPitch(36), false);
      for (const note of notes) for (const pitch of [note.absolutePitch, note.endPitch].filter(Boolean))
        assert.ok(pitch!.millicents >= 5200000 && pitch!.millicents <= 9600000);
      return { notes, written: snapshot.themeCore!.notes };
    };
    const plain = run(0), dressed = run(1);
    const identity = (notes: typeof plain.notes) => notes.filter(note => note.expression?.role === 'anchor')
      .map(note => [note.tick, note.absolutePitch, note.expression!.sourceId]);
    assert.deepEqual(identity(dressed.notes), identity(plain.notes), 'Delivery cannot force a whole-core octave change.');
    for (const source of dressed.written.filter(note => ['head', 'apex', 'cadence'].includes(note.role))) {
      const original = plain.written.find(note => note.startTick === source.startTick && note.sourceId === source.sourceId)!;
      assert.equal(source.endTick, original.endTick);
    }
  }
});
