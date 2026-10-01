import test from 'node:test';
import assert from 'node:assert/strict';
import { selectLiveCrest } from '../src/live-audio-audit';
import { createPerformance } from '../src/serialization';
import { explorationPerformance } from '../src/exploration';
import { MusicEngine } from '../src/engine';
import { FRAME_TICKS, PPQ, type Frame, type Performance } from '../src/types';

const generate = (recipe: Performance, count: number) => {
  const engine = new MusicEngine({ ...recipe, parameters: recipe.initialParameters });
  return Array.from({ length: count }, () => engine.step());
};
function reading(frames: Frame[]) {
  const mean = (fn: (frame: Frame) => number) => frames.reduce((sum, frame) => sum + fn(frame), 0) / frames.length;
  const energy = mean(frame => frame.diagnostics.compositionExpression!.energy), activity = mean(frame => frame.diagnostics.compositionExpression!.activity);
  const density = mean(frame => frame.parameters.rhythmicDensity * .7 + frame.parameters.ideaDensity * .3);
  const attacks = frames.reduce((sum, frame) => sum + frame.notes.length, 0) / frames.reduce((sum, frame) => sum + frame.duration / PPQ, 0);
  return { energy, activity, density, attacks, score: energy * .3 + activity * .3 + density * .2 + Math.min(1, attacks / 8) * .2 };
}

test('live crest selection observes a real dense theme without requiring a climax role', async () => {
  const recipe = explorationPerformance(createPerformance('amber-current'), 'amber-current').recipe, before = structuredClone(recipe);
  const selected = await selectLiveCrest(recipe, { maxFrames: 64 });
  assert.deepEqual(recipe, before);
  assert.equal(selected.reason, 'first-dense-window');
  assert.equal(selected.startTick, 0); assert.equal(selected.examinedFrames, 8);
  assert.equal(selected.endTick - selected.startTick, FRAME_TICKS * 8);
  const frames = generate(recipe, 8), actual = reading(frames);
  assert.ok(frames.every(frame => frame.form!.role !== 'climax'));
  assert.equal(selected.meanEnergy, actual.energy); assert.equal(selected.meanActivity, actual.activity);
  assert.equal(selected.meanDensity, actual.density); assert.equal(selected.attacksPerBeat, actual.attacks);
  assert.ok(selected.meanEnergy >= .65 && selected.meanActivity >= .62 && selected.meanDensity >= .55 && selected.attacksPerBeat >= 2);
});

test('quiet scores use an explicitly labelled strongest observed fallback from the bounded prefix', async () => {
  const recipe = createPerformance('quiet-selection');
  recipe.conductor!.amount = 0; recipe.conductor!.tuningTravel = false;
  recipe.phrasing!.composition!.dynamicRange = 0;
  recipe.initialParameters.rhythmicDensity = 0; recipe.initialParameters.ideaDensity = 0; recipe.initialParameters.ensembleSize = 0;
  const selected = await selectLiveCrest(recipe, { maxFrames: 40 }), frames = generate(recipe, 40);
  assert.equal(selected.reason, 'strongest-observed-window');
  assert.match(selected.explanation, /No window met every dense threshold/);
  assert.equal(selected.examinedFrames, 40); assert.equal(selected.examinedThroughTick, 40 * FRAME_TICKS);
  const windows = Array.from({ length: 33 }, (_, start) => ({ start, ...reading(frames.slice(start, start + 8)) }));
  const expected = windows.reduce((best, window) => window.score > best.score ? window : best);
  assert.equal(selected.startTick, expected.start * FRAME_TICKS);
  assert.equal(selected.score, expected.score);
  assert.equal(selected.meanEnergy, expected.energy);
  assert.ok(selected.meanEnergy < .65 && selected.meanDensity < .55);
  assert.deepEqual(await selectLiveCrest(recipe, { maxFrames: 40 }), selected);
});

test('crest preparation remains bounded and can be aborted between yielding batches', async () => {
  const recipe = createPerformance('bounded-selection');
  recipe.phrasing!.composition!.dynamicRange = 0;
  const minimum = await selectLiveCrest(recipe, { maxFrames: 1 });
  assert.equal(minimum.examinedFrames, 8);
  const signal = new AbortController(); let updates = 0;
  await assert.rejects(selectLiveCrest(recipe, { maxFrames: Infinity, signal: signal.signal,
    onPreparing: () => { updates++; signal.abort(); } }), { name: 'AbortError' });
  assert.equal(updates, 1);
});
