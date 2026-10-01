import test from 'node:test';
import assert from 'node:assert/strict';
import { controlledRangeRecipe, renderRange, summarizeRange } from '../scripts/audit-range';
import { createPerformance, parsePerformance, serializePerformance, upgradeParameterVector } from '../src/serialization';
import { DEFAULT_PARAMETERS } from '../src/parameters';
import { MusicEngine } from '../src/engine';
import { midiToPitch, degreeToPitch, pitchToDegree } from '../src/pitch';
import type { Frame, NoteEvent } from '../src/types';

const results = new Map<string, ReturnType<typeof renderRange>>();
function controlled(ideas: 0 | 1, players: 0 | 1, native = false) {
  const key = `${ideas}:${players}:${native}`;
  let value = results.get(key);
  if (!value) {
    value = renderRange(controlledRangeRecipe('range-integration', ideas, players, native ? '19edo' : '12tet'));
    results.set(key, value);
  }
  return value;
}

test('new macro migration accepts only complete old vectors and leaves current documents strict', () => {
  const { ideaDensity: _ideas, ensembleSize: _players, ...old } = DEFAULT_PARAMETERS;
  const snapshot = structuredClone(old), migrated = upgradeParameterVector(old);
  assert.deepEqual(old, snapshot);
  assert.equal(migrated.ideaDensity, .5); assert.equal(migrated.ensembleSize, .55);
  assert.deepEqual(migrated, DEFAULT_PARAMETERS);
  assert.deepEqual(upgradeParameterVector({ ...DEFAULT_PARAMETERS, ideaDensity: 0, ensembleSize: 1 }), { ...DEFAULT_PARAMETERS, ideaDensity: 0, ensembleSize: 1 });
  const recipe = createPerformance('strict-range');
  assert.throws(() => parsePerformance(JSON.stringify({ ...recipe, initialParameters: old })), /unknown or missing parameter/);
  assert.throws(() => upgradeParameterVector({ ...old, ideaDensity: .5 }), /unknown or missing parameter/);
  assert.throws(() => upgradeParameterVector({ ...old, tempo: NaN }));
  assert.throws(() => upgradeParameterVector({ ...old, accidental: .4 }));
  const { tempo: _tempo, ...incomplete } = old;
  assert.throws(() => upgradeParameterVector(incomplete));
  assert.deepEqual(parsePerformance(serializePerformance({ ...recipe, initialParameters: migrated })).initialParameters, migrated);
});

test('range measurement counts heard holds and rest scopes without resurrecting replaced notes', () => {
  const recipe = createPerformance('measurement-fixture');
  const template = new MusicEngine({ ...recipe, parameters: recipe.initialParameters }).step();
  const note = (id: string, tick: number, duration: number, voice = 5): NoteEvent => ({ id, tick, duration, voice,
    absolutePitch: midiToPitch(60 + voice), part: 'melody', velocity: .6, timbre: 'strings' });
  const frame: Frame = { ...template, tick: 0, duration: 960, notes: [note('held', 0, 960), note('replaces', 480, 120)], phrase: undefined };
  const replaced = summarizeRange([frame]);
  assert.equal(replaced.occupancy.maxVoices, 1);
  assert.equal(replaced.occupancy.meanVoices, .625);
  assert.equal(replaced.occupancy.silenceFraction, .375);
  const interrupted = summarizeRange([{ ...frame, notes: [note('first', 0, 960), note('other', 0, 960, 8)],
    phrase: { ...template.phrase!, rests: [{ startTick: 480, endTick: 960, scope: 'lead', voices: [5], reason: 'Test a scoped release.' }] } }]);
  assert.equal(interrupted.occupancy.maxVoices, 2);
  assert.equal(interrupted.occupancy.meanVoices, 1.5);
  assert.equal(interrupted.occupancy.singleVoiceFraction, .5);
});

test('idea density changes actual foreground composition while arrangement controls actual player count', () => {
  for (const players of [0, 1] as const) {
    const sparse = controlled(0, players).summary, dense = controlled(1, players).summary;
    assert.ok(sparse.leadAttacksPerQuarter < .75, `Sparse route has ${sparse.leadAttacksPerQuarter} attacks/quarter; short episodes still retain a complete head and arrival.`);
    assert.ok(dense.leadAttacksPerQuarter > 1.5, `Dense lead has ${dense.leadAttacksPerQuarter} attacks/quarter.`);
    assert.ok(dense.leadAttacksPerQuarter > sparse.leadAttacksPerQuarter * 3);
    assert.ok(dense.leadSourceIds > sparse.leadSourceIds, 'Density includes actual authored material, not only doubled players.');
    for (const result of [sparse, dense]) {
      assert.ok(result.nativeNotesValid && result.allThemeCores && result.plannedVoicingsMatchDestinations);
      assert.deepEqual(result.tempo, [108, 108]);
    }
  }
  for (const ideas of [0, 1] as const) {
    const solo = controlled(ideas, 0), tutti = controlled(ideas, 1);
    assert.deepEqual(solo.summary.pitchedVoices, [5]);
    assert.equal(solo.summary.occupancy.maxVoices, 1);
    assert.equal(solo.summary.notesByPart.percussion, 0);
    assert.ok(tutti.summary.occupancy.maxVoices >= 10);
    assert.ok(tutti.summary.colors.length >= 4);
    assert.ok(tutti.summary.arrangementDiagnosticsPresent && solo.summary.arrangementDiagnosticsPresent);
    assert.deepEqual(solo.frames.flatMap(frame => frame.notes).filter(note => note.voice === 5),
      tutti.frames.flatMap(frame => frame.notes).filter(note => note.voice === 5), 'Changing player count preserves the foreground composition.');
  }
});

test('range endpoints retain full serialized replay and the native additive reference exception', () => {
  for (const ideas of [0, 1] as const) for (const players of [0, 1] as const) assert.equal(controlled(ideas, players).exactReplay, true);
  const sparse = controlled(0, 0, true), dense = controlled(1, 1, true);
  for (const result of [sparse, dense]) {
    assert.equal(result.exactReplay, true);
    assert.ok(result.summary.nativeNotesValid && result.summary.allThemeCores);
    assert.ok([0, 1, 2, 3, 4, 5].every(voice => result.summary.pitchedVoices.includes(voice)), 'The additive rack retains its reference pitches independently of ensemble size.');
    assert.ok(result.summary.occupancy.referenceBedFraction > .8, 'The native reference is a sounding bed, not merely five advertised voice IDs.');
    for (const frame of result.frames) for (const note of frame.notes.filter(note => note.part !== 'percussion')) {
      assert.ok(Math.abs(note.absolutePitch!.millicents - degreeToPitch('19edo', pitchToDegree('19edo', note.absolutePitch!)).millicents) <= 1);
    }
  }
  assert.ok(dense.summary.leadAttacksPerQuarter > sparse.summary.leadAttacksPerQuarter * 3);
});
