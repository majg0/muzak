import test from 'node:test';
import assert from 'node:assert/strict';
import { generateRangeMatrix, rangeCases, rangeScoreSummary } from '../src/range-audit';

test('the controlled audition varies only idea density and ensemble size', () => {
  const cases = rangeCases();
  const comparable = (index: number) => {
    const recipe = structuredClone(cases[index].recipe);
    recipe.initialParameters.ideaDensity = .5; recipe.initialParameters.ensembleSize = .5;
    return recipe;
  };
  for (let index = 1; index < cases.length; index++) assert.deepEqual(comparable(index), comparable(0));
  assert.deepEqual(cases.map(item => [item.ideaDensity, item.ensembleSize]), [[0, 0], [1, 0], [0, 1], [1, 1]]);
  for (const item of cases) {
    assert.equal(item.recipe.conductor!.amount, 0); assert.equal(item.recipe.conductor!.tuningTravel, false);
    assert.equal(item.recipe.phrasing!.composition!.dynamicRange, 0);
    assert.equal(item.recipe.sound.tuning, '12tet'); assert.equal(item.recipe.initialParameters.tempo, 88);
    assert.deepEqual(item.recipe.automation, []);
  }
});

test('the matrix measures a complete shared interval, a real solo and a denser authored foreground', async () => {
  const matrix = await generateRangeMatrix();
  const reports = matrix.cases.map(item => rangeScoreSummary(item.frames));
  assert.ok(matrix.endTick > matrix.startTick);
  assert.ok(matrix.cases.every(item => item.frames[0].tick === matrix.startTick
    && item.frames.at(-1)!.tick + item.frames.at(-1)!.duration === matrix.endTick));
  const [sparseSolo, denseSolo, sparseFull, denseFull] = reports;
  assert.ok(sparseSolo.leadAttacksPerBeat < .75 && sparseSolo.medianLeadOnsetGapBeats >= 1);
  assert.ok(denseSolo.leadAttacksPerBeat > 1.5 && denseSolo.leadAttacksPerBeat > sparseSolo.leadAttacksPerBeat * 3);
  for (const solo of [sparseSolo, denseSolo]) {
    assert.deepEqual(solo.pitchedVoices, [5]); assert.equal(solo.percussionEvents, 0);
    assert.equal(solo.maximumSimultaneousPitchedVoices, 1);
  }
  assert.equal(sparseSolo.leadFingerprint, sparseFull.leadFingerprint);
  assert.equal(denseSolo.leadFingerprint, denseFull.leadFingerprint);
  for (const full of [sparseFull, denseFull]) {
    assert.ok(full.maximumSimultaneousPitchedVoices >= 8 && full.instrumentColors.length >= 4);
    assert.ok(full.percussionEvents > 0 && full.sharedBackingOnsets > 0);
  }
});
