import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONDUCTOR, formAt } from '../src/conductor';
import { openingGesture } from '../src/form-score';
import { DEFAULT_PARAMETERS, evaluateAutomation } from '../src/parameters';
import { expressiveContourAt } from '../src/engine/expression';
import { compositionExpressionAt } from '../src/engine/composition-expression';
import { explorationPerformance } from '../src/exploration';
import { createPerformance, parsePerformance, serializePerformance } from '../src/serialization';
import { ScoreTimeline } from '../src/engine/score-timeline';

const wide = { ...DEFAULT_CONDUCTOR, amount: 1 };
const lookup = (seed: string) => (tick: number) => formAt(seed, tick, wide);

test('wide opening recipes include immediate force, exposed lines, repetition, quiet and broad slow ensembles', () => {
  const openings = new Set<string>(), strategies = new Set<string>();
  for (let index = 0; index < 96; index++) {
    const seed = `opening-delivery-${index}`, at = lookup(seed), form = at(0), opening = openingGesture(seed);
    const start = compositionExpressionAt(seed, 0, DEFAULT_PARAMETERS, at, 1);
    openings.add(opening); strategies.add(form.behavior!.strategy);
    assert.equal(start.parameters.tempo, DEFAULT_PARAMETERS.tempo);
    if (opening === 'attack') {
      assert.ok(start.expression.intensity > .98 && start.texture.pace > .95);
      assert.ok(start.parameters.ideaDensity > .85 && start.parameters.ensembleSize > .95);
      assert.equal(form.role, 'theme', 'A forceful entrance states a new theme, rather than pretending an unheard theme has reached its climax.');
      const later = compositionExpressionAt(seed, form.barTicks, DEFAULT_PARAMETERS, at, 1);
      assert.ok(Math.abs(later.expression.intensity - start.expression.intensity) < .002, 'The attack does not become a mandatory opening crescendo.');
    } else if (opening === 'drive') {
      assert.ok(start.texture.pace > .8 && start.parameters.ideaDensity < .3, 'Repeated propulsion differs from introducing a flood of ideas.');
    } else if (opening === 'soliloquy') {
      assert.ok(start.parameters.ensembleSize < .03 && start.parameters.ideaDensity < .15);
    } else if (opening === 'swarm') {
      assert.ok(start.parameters.ideaDensity > .95 && start.texture.pace > .95);
    } else if (opening === 'panorama') {
      assert.ok(start.parameters.ensembleSize > .95 && start.texture.pace < .3 && start.parameters.ideaDensity < .2);
    } else assert.ok(start.expression.intensity < .03 && start.texture.pace < .15);
  }
  assert.equal(openings.size, 6);
  assert.ok(strategies.size >= 3, 'Labels describe continuous trajectories; all preset categories need not occur in a fixed opening cohort.');
});

test('rare planned cuts preserve their outgoing block while flowing edges remain continuous', () => {
  let strongCuts = 0, cuts = 0, flows = 0;
  for (let index = 0; index < 16; index++) {
    const seed = `contrast-delivery-${index}`, at = lookup(seed);
    for (let tick = 0, section = 0; section < 32; section++) {
      const current = at(tick), next = at(current.sectionEndTick);
      const before = expressiveContourAt(seed, current.sectionEndTick - 1, at), after = expressiveContourAt(seed, current.sectionEndTick, at);
      if (next.behavior?.entry === 'cut') {
        cuts++;
        assert.ok(Math.abs(before.energy - current.behavior!.energy) < .00001, 'A cut must not be secretly pre-smoothed into the incoming section.');
        if (Math.abs(after.energy - before.energy) > .4) strongCuts++;
      } else {
        flows++;
        for (const key of ['energy', 'activity', 'intensity', 'register', 'ideaDensity', 'ensembleSize'] as const) assert.ok(Math.abs(after[key]! - before[key]!) < .001);
      }
      if (current.role === 'breakdown') assert.ok(current.behavior!.energy < .1);
      tick = current.sectionEndTick;
    }
  }
  assert.ok(flows > 490 && cuts < 16 && strongCuts <= cuts, 'Prepared motion dominates rather than mandatory cuts at each contrast.');
});

test('restrained form keeps flowing openings, and explicit density and ensemble automation wins', () => {
  for (let index = 0; index < 32; index++) {
    const seed = `restrained-opening-${index}`, at = (tick: number) => formAt(seed, tick, { ...wide, amount: .28 });
    assert.equal(at(0).behavior!.entry, 'flow');
    assert.ok(at(0).behavior!.ending, 'Restrained form still carries a shared handoff decision.');
    const opening = expressiveContourAt(seed, 0, at);
    assert.ok(opening.intensity < .35 && opening.activity < .45);
    const full = compositionExpressionAt(seed, 0, DEFAULT_PARAMETERS, lookup(seed), 1);
    const overridden = evaluateAutomation(full.parameters, [
      { parameter: 'ideaDensity', points: [{ tick: 0, value: 0 }] },
      { parameter: 'ensembleSize', points: [{ tick: 0, value: 1 }] },
    ], 0);
    assert.equal(overridden.ideaDensity, 0); assert.equal(overridden.ensembleSize, 1);
  }
});

test('serialized Wide scores retain diverse immediate intentions and are independent of query order', () => {
  const starts: ReturnType<ScoreTimeline['at']>[] = [];
  for (let index = 0; index < 32; index++) {
    const { recipe } = explorationPerformance(createPerformance('source'), `serialized-delivery-${index}`);
    const loaded = parsePerformance(serializePerformance(recipe));
    const timeline = new ScoreTimeline({ ...loaded, parameters: loaded.initialParameters });
    const start = timeline.at(0); starts.push(start);
    timeline.at(100000); timeline.at(960); timeline.at(50000);
    assert.deepEqual(timeline.at(0), start);
    assert.deepEqual(new ScoreTimeline({ ...recipe, parameters: recipe.initialParameters }).at(0), start);
  }
  assert.ok(starts.some(value => value.expression.intensity > .9 && value.texture.pace > .85));
  assert.ok(starts.some(value => value.expression.intensity < .13 && value.texture.pace < .2));
  assert.ok(starts.some(value => value.parameters.ensembleSize < .1));
  assert.ok(starts.some(value => value.parameters.ensembleSize > .88 && value.parameters.ideaDensity < .25));
});

test('initial density and ensemble preferences keep literal endpoints and monotonically bias the whole expressive story', () => {
  const seed = 'preferences-have-meaning', at = lookup(seed);
  for (const tick of [0, 960, 10000, 50000, 150000]) {
    for (const key of ['ideaDensity', 'ensembleSize'] as const) {
      const readings = [0, .2, .5, .8, 1].map(baseline => compositionExpressionAt(seed, tick,
        { ...DEFAULT_PARAMETERS, [key]: baseline }, at, 1).parameters[key]);
      assert.equal(readings[0], 0); assert.equal(readings.at(-1), 1);
      assert.ok(readings.slice(1).every((value, index) => value > readings[index]), 'The slider remains a preference even at full expressive breadth.');
    }
  }
  const opening = compositionExpressionAt(seed, 0, DEFAULT_PARAMETERS, at, 1);
  assert.ok(Math.abs(opening.parameters.ideaDensity - opening.expression.ideaDensity!) < .000001);
  assert.ok(Math.abs(opening.parameters.ensembleSize - opening.expression.ensembleSize!) < .000001);
  for (const endpoint of [0, 1]) {
    const recipe = createPerformance(seed);
    recipe.conductor = wide;
    recipe.phrasing!.composition!.dynamicRange = 1;
    recipe.initialParameters.ideaDensity = endpoint; recipe.initialParameters.ensembleSize = endpoint;
    const timeline = new ScoreTimeline({ ...recipe, parameters: recipe.initialParameters });
    for (const tick of [0, 960, 10000, 50000, 150000]) {
      assert.equal(timeline.at(tick).parameters.ideaDensity, endpoint, 'The conductor cannot overwrite the initial endpoint before expression.');
      assert.equal(timeline.at(tick).parameters.ensembleSize, endpoint);
    }
  }
});
