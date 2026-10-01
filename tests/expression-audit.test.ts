import test from 'node:test';
import assert from 'node:assert/strict';
import { MusicEngine } from '../src/engine';
import { explorationPerformance } from '../src/exploration';
import { createPerformance } from '../src/serialization';
import { expressionScoreSummary, selectExpressionExcerpts } from '../src/expression-audit';
import type { Frame } from '../src/types';

test('Wide exploration audition selects the complete first narrative and its actual calm/peak contour', () => {
  let fills = 0, counterNotes = 0, journeysWithoutNamedClimax = 0;
  for (const seed of ['glass-garden', 'velvet-orbit', 'amber-current']) {
    const { recipe } = explorationPerformance(createPerformance(seed), seed);
    const engine = new MusicEngine({ seed, parameters: recipe.initialParameters, conductor: recipe.conductor, phrasing: recipe.phrasing, sound: recipe.sound });
    const frames: Frame[] = [];
    let ended = false;
    for (let index = 0; index < 450; index++) {
      const frame = engine.step();
      if (frame.form!.cycle > 0) { ended = true; break; }
      frames.push(frame);
    }
    assert.ok(ended && frames.length > 50);
    const excerpts = selectExpressionExcerpts(frames, seed, 8, recipe.conductor!);
    assert.deepEqual(excerpts.map(excerpt => excerpt.kind).sort(), ['calm', 'crest', 'retreat', 'rise']);
    for (const [index, excerpt] of excerpts.entries()) {
      assert.equal(excerpt.end - excerpt.start, 8);
      assert.ok(excerpt.start >= 0 && excerpt.end <= frames.length && (index === 0 || excerpt.start >= excerpts[index - 1].end));
      const actualMean = frames.slice(excerpt.start, excerpt.end).reduce((sum, frame) => sum + frame.diagnostics.compositionExpression!.energy, 0) / 8;
      assert.ok(Math.abs(actualMean - excerpt.meanEnergy) < 1e-12, 'Selection uses the shared score expression, not a separately reconstructed envelope.');
    }
    const region = (kind: typeof excerpts[number]['kind']) => excerpts.find(excerpt => excerpt.kind === kind)!;
    assert.ok(region('crest').meanEnergy - region('calm').meanEnergy > .25);
    assert.ok(region('rise').energyChange > .03 && region('retreat').energyChange < -.03);
    const summary = (kind: typeof excerpts[number]['kind']) => {
      const excerpt = region(kind);
      return expressionScoreSummary(frames.slice(excerpt.start, excerpt.end), frames[excerpt.start].tick);
    };
    const calm = summary('calm'), peak = summary('crest');
    assert.ok(excerpts.some(excerpt => summary(excerpt.kind).changingHeldGainNotes > 0), 'Held expression may belong to an exposed lead, not only four upper voices.');
    assert.ok(calm.meanVelocity > .08 && peak.meanVelocity > calm.meanVelocity, 'Calm remains audible while the crest gains strength.');
    assert.ok(calm.structuralMelody.notes > 0, 'An exposed low-energy region still contains a written thematic source.');
    const complete = expressionScoreSummary(frames, 0);
    assert.ok(complete.structuralMelody.notes > complete.ornaments.notes * 4, 'Surface detail supports a recognizable core rather than replacing it.');
    fills += complete.orchestralFills.notes; counterNotes += complete.independentCounter.notes;
    assert.ok(frames.every(frame => Math.abs(frame.diagnostics.orchestration!.requestedEnergy - frame.diagnostics.compositionExpression!.energy) < .000001));
    if (!frames.some(frame => frame.form!.role === 'climax')) journeysWithoutNamedClimax++;
  }
  assert.ok(fills > 0 && counterNotes > 0, 'The sampled arrangements actually realize both fills and independent voices without forcing them into every opening.');
  assert.ok(journeysWithoutNamedClimax > 0, 'A measured energy crest does not require the same named formal arrival in every narrative.');
});

test('an immediate crest and later calm are selected as heard, without inventing a mandatory buildup', () => {
  const expression = Array.from({ length: 64 }, (_, i) => i < 8 ? 1 : i < 16 ? 1 - (i - 8) / 8
    : i < 32 ? .02 : i < 40 ? .02 + (i - 32) * .1 : i < 48 ? .7 : .2);
  const frames = expression.map((energy, index) => ({ tick: index * 960,
    diagnostics: { compositionExpression: { energy } } })) as Frame[];
  const selections = selectExpressionExcerpts(frames, 'opening-crest');
  assert.equal(selections[0].kind, 'crest');
  assert.equal(selections[0].start, 0);
  assert.ok(selections.find(region => region.kind === 'calm')!.meanEnergy < .03);
  assert.ok(selections.find(region => region.kind === 'rise')!.energyChange > .5);
  assert.ok(selections.find(region => region.kind === 'retreat')!.energyChange < -.5);
  assert.ok(selections.every((region, i) => !i || region.start >= selections[i - 1].end));
});
