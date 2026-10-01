import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_HARMONY, validateHarmony } from '../src/harmonic-language';
import { DEFAULT_PHRASING, validatePhrasing } from '../src/phrasing';
import { lyricalPerformance } from '../src/lyrical';
import { createPerformance, serializePerformance, parsePerformance } from '../src/serialization';
import { MusicEngine, eventHash } from '../src/engine';
import { composeThematicComparison, melodySignature } from '../src/thematic-audit';
import { degreeToPitch, pitchToDegree } from '../src/pitch';
import { melodicAnchorsAt } from '../src/engine/melodic-anchors';
import type { ThemeCoreSnapshot } from '../src/engine/theme-core';

test('harmonic anchors retain actual overlapping duration and thematic salience', () => {
  const core: ThemeCoreSnapshot = { id: 'core', name: 'Core', headId: 'head', grammar: 'period', treatment: 'reharmonize', occurrence: 0, transpositionDegrees: 0,
    notes: [
      { id: 'held', sourceId: 'h', degree: 0, role: 'head', purpose: 'identity', startTick: 0, endTick: 2400, absolutePitchCents: 7200 },
      { id: 'approach', sourceId: 'a', degree: 1, role: 'approach', purpose: 'approach', startTick: 2400, endTick: 2640, absolutePitchCents: 7400 },
    ] };
  const anchors = melodicAnchorsAt(core, 1920, 960);
  assert.deepEqual(anchors, [{ cents: 7200, weight: 1.4 }, { cents: 7400, weight: .5 }]);
  assert.deepEqual(melodicAnchorsAt(core, 3000, 960), []);
  assert.equal(melodicAnchorsAt(core, 0, 1920)[0].weight, 5.6);
});

test('harmonic language is explicit serialized state with strict imports and no legacy injection', () => {
  assert.equal(validatePhrasing(DEFAULT_PHRASING).harmony, undefined);
  for (const value of [null, [], { ...DEFAULT_HARMONY, harmonicColor: NaN }, { ...DEFAULT_HARMONY, functionalMotion: 2 },
    { ...DEFAULT_HARMONY, strategy: 'anything' }, { ...DEFAULT_HARMONY, treatment: 'randomize' }, { ...DEFAULT_HARMONY, hidden: 1 }]) {
    assert.throws(() => validateHarmony(value));
  }
  const recipe = lyricalPerformance(createPerformance('a-clear-idea')).recipe;
  assert.deepEqual(parsePerformance(serializePerformance(recipe)), recipe);
  assert.deepEqual(recipe.phrasing!.harmony, DEFAULT_HARMONY);
});

test('three harmonic readings preserve physical melody and time while actually changing accompaniment in both tunings', async () => {
  for (const seed of ['glass-garden', 'velvet-orbit', 'core-5']) for (const tuning of ['12tet', '19edo'] as const) {
    const recipe = createPerformance(seed); recipe.sound.tuning = tuning;
    if (tuning === '19edo') recipe.sound.instrument = 'additive';
    const { cases } = await composeThematicComparison(recipe);
    assert.equal(new Set(cases.map(item => melodySignature(item.frames))).size, 1);
    assert.equal(new Set(cases.map(item => eventHash(item.frames.flatMap(frame => frame.notes).filter(note => note.part !== 'melody')))).size, 3);
    for (const { frames } of cases) {
      assert.equal(frames[0].form!.role, 'theme', 'A short introduction must not substitute for the full thematic argument.');
      assert.equal(frames.at(-1)!.phrase!.composition!.cadence, 'closed');
      assert.ok(frames.every(frame => frame.diagnostics.harmonicPlan?.realization.matched));
      const changes = frames.filter(frame => frame.tick === frame.diagnostics.harmonicPlan!.current.startTick);
      assert.ok(new Set(changes.map(frame => frame.diagnostics.harmonicPlan!.current.pitchClasses.join(','))).size >= 2,
        'A short complete argument needs a heard harmonic relation; three distinct roots are not required for a common-tone return.');
      for (const frame of frames) for (const note of frame.notes.filter(note => note.part !== 'percussion')) {
        assert.equal(degreeToPitch(tuning, pitchToDegree(tuning, note.absolutePitch!)).millicents, note.absolutePitch!.millicents);
        if (tuning === '19edo') assert.equal(note.midiNote, undefined);
      }
    }
  }
});

test('themed replay preserves destinations, cores and event stream after serialization', () => {
  const original = lyricalPerformance(createPerformance('amber-current')).recipe;
  original.sound = { ...original.sound, tuning: '19edo', instrument: 'additive' };
  original.phrasing!.harmony = { ...DEFAULT_HARMONY, strategy: 'third-cycle', treatment: 'sequence' };
  const restored = parsePerformance(serializePerformance(original));
  const a = new MusicEngine({ ...original, parameters: original.initialParameters });
  const b = new MusicEngine({ ...restored, parameters: restored.initialParameters });
  for (let index = 0; index < 128; index++) assert.deepEqual(a.step(), b.step());
});
