import test from 'node:test';
import assert from 'node:assert/strict';
import { generateIdeaCell, thematicCell, metricDepth, metricStrength, subdivideBetweenTargets } from '../src/engine/idea-kernel';

test('hierarchical subdivision retains written targets as detail grows', () => {
  const input = { startTick: 240, endTick: 5520, gridTicks: 60, pulseTicks: 480,
    originTick: 0, anchors: [{ tick: 1920, strength: 1 }, { tick: 4800, strength: .95 }], attackBudget: 8 };
  const before = structuredClone(input);
  const low = subdivideBetweenTargets('landmarks', 'a', input);
  const high = subdivideBetweenTargets('landmarks', 'a', { ...input, attackBudget: 23 });
  assert.deepEqual(input, before);
  for (const note of low) assert.ok(high.some(point => point.tick === note.tick), `Lost target at ${note.tick}`);
  for (const note of high) {
    assert.ok(Number.isInteger(note.tick) && Number.isInteger(note.durationTicks) && note.durationTicks > 0);
    assert.ok(note.tick >= input.startTick && note.tick < input.endTick);
  }
  assert.equal(high.reduce((sum, note) => sum + note.durationTicks, 0), input.endTick - input.startTick);
  assert.equal(high.find(note => note.tick === 4800)?.level, 'goal');
  assert.equal(high.find(note => note.tick === 1920)?.strength, 1);
});

test('theme source generation is replayable and independent of unrelated queries', () => {
  const first = thematicCell('composition', 'theme-a');
  for (let index = 0; index < 30; index++) thematicCell(`other-${index}`, 'theme-a');
  assert.deepEqual(thematicCell('composition', 'theme-a'), first);
  const cells = Array.from({ length: 64 }, (_, index) => thematicCell(`source-${index}`, 'theme-a'));
  for (const cell of cells) {
    assert.equal(cell.groups.reduce((sum, duration) => sum + duration, 0), cell.units);
    assert.equal(cell.attacks.reduce((sum, note) => sum + note.holdUnits, 0), cell.units);
    assert.ok(cell.attacks.length >= 3 && cell.attacks.length <= 4);
    assert.equal(cell.attacks[0].unit, 0);
    assert.ok(cell.attacks.at(-1)!.holdUnits >= 2, 'A source goal needs room to be heard');
  }
  assert.ok(new Set(cells.map(cell => cell.units)).size >= 5, 'Generated spans must not be one fixed bar');
  assert.ok(new Set(cells.map(cell => cell.attacks.map(note => note.holdUnits).join(','))).size >= 10);
});

test('metrical accents distinguish downbeats, source groups, ordinary beats and detail', () => {
  const context = { originTick: 1920, beatTicks: 240, barTicks: 1680, groups: [3, 2, 2] };
  const levels = [1920, 2640, 2160, 2040, 1980].map(tick => metricStrength(tick, context));
  assert.ok(levels.every((value, index) => index === 0 || value < levels[index - 1]));
  assert.equal(metricStrength(1920 + 1680, context), 1);
  assert.equal(metricStrength(1920 - 1680, context), 1);
});

test('cell density changes the subdivision budget while preserving a strong held destination', () => {
  const low = generateIdeaCell('source', 'head', { units: 28, count: 3 });
  const high = generateIdeaCell('source', 'head', { units: 28, count: 10 });
  assert.ok(high.attacks.length > low.attacks.length);
  for (const note of low.attacks) assert.ok(high.attacks.some(point => point.unit === note.unit));
  assert.ok(low.attacks.some(note => note.unit > 0 && note.strength >= .95));
  assert.deepEqual(high.attacks.at(-1), low.attacks.at(-1), 'Detail must preserve the residence of the goal');
  assert.throws(() => subdivideBetweenTargets('a', 'b', { startTick: 0, endTick: 0, gridTicks: 60, attackBudget: 10 }));
});

test('rational meter distinguishes triplet parents, their children, and displaced meter origins', () => {
  const context = { originTick: 17, beatTicks: 480, barTicks: 1920 };
  const half = metricDepth(257, context), third = metricDepth(177, context);
  assert.ok(half < third && third < metricDepth(137, context));
  assert.equal(metricDepth(97, context) - third, 1, 'Dividing a triplet in two adds exactly one level');
  assert.equal(metricStrength(177, context), metricStrength(337, context));
  assert.equal(metricStrength(177, context), metricStrength(177 - 1920, context));
  assert.ok(metricStrength(177, context) > metricStrength(97, context));
  const fraction = { originTick: 0, beatTicks: 1, barTicks: 4 };
  assert.ok(metricStrength(1 / 3, fraction) > metricStrength(1 / 6, fraction));
});

test('detail admission is nested at every budget on mixed integer and tuplet grids', () => {
  for (const gridTicks of [40, 60, 80, 96, 120]) {
    const input = { startTick: 17, endTick: 3377, originTick: 0, gridTicks, pulseTicks: 480,
      anchors: [{ tick: 799, strength: .97 }, { tick: 2241, strength: .94 }], syncopation: .8 };
    let previous: ReturnType<typeof subdivideBetweenTargets> = [];
    for (let attackBudget = 1; attackBudget <= 45; attackBudget++) {
      const current = subdivideBetweenTargets('rational', 'nested', { ...input, attackBudget });
      const ticks = new Set(current.map(note => note.tick));
      assert.equal(ticks.size, current.length);
      assert.ok(previous.every(note => ticks.has(note.tick)));
      assert.equal(current.reduce((sum, note) => sum + note.durationTicks, 0), input.endTick - input.startTick);
      for (const [index, note] of current.entries()) {
        assert.ok(Number.isSafeInteger(note.tick) && Number.isSafeInteger(note.durationTicks) && note.durationTicks > 0);
        if (note.level !== 'goal') {
          assert.equal(note.tick % gridTicks, 0);
          assert.ok(note.tick - current[index - 1].tick >= gridTicks);
          assert.ok(note.durationTicks >= gridTicks);
        }
      }
      previous = current;
    }
  }
});

test('hierarchy exponentially favors pulse and exposes controlled syncopation', () => {
  let structuredDepth = 0, permissiveDepth = 0, syncopatedDepth = 0;
  const context = { originTick: 0, beatTicks: 480, barTicks: 480 * 64 };
  for (let seed = 0; seed < 160; seed++) {
    const input = { startTick: 0, endTick: context.barTicks, gridTicks: 40, pulseTicks: 480, attackBudget: 9 };
    const totalDepth = (hierarchyDecay: number, syncopation: number) => subdivideBetweenTargets(`${seed}`, 'spectrum', {
      ...input, hierarchyDecay, syncopation,
    }).slice(1).reduce((sum, note) => sum + metricDepth(note.tick, context) - 1, 0);
    structuredDepth += totalDepth(3, 0);
    permissiveDepth += totalDepth(0, 0);
    syncopatedDepth += totalDepth(3, 1);
  }
  assert.ok(structuredDepth < permissiveDepth * .2, `${structuredDepth} vs ${permissiveDepth}`);
  assert.ok(syncopatedDepth > structuredDepth * 2, `${syncopatedDepth} vs ${structuredDepth}`);
  assert.ok(syncopatedDepth < permissiveDepth, 'Syncopation still respects metrical hierarchy');
});

test('coarse structure remains discoverable across long spans and bounded at extreme budgets', () => {
  const attacks = subdivideBetweenTargets('long', 'pulse', { startTick: 7, endTick: 480 * 1_000_000 + 7,
    originTick: 7, gridTicks: 40, pulseTicks: 480, hierarchyDecay: 20, attackBudget: 2000 });
  assert.equal(attacks.length, 128);
  assert.ok(attacks.every(note => (note.tick - 7) % 480 === 0));
  assert.ok(attacks.every(note => note.durationTicks > 0));
  assert.equal(attacks.reduce((sum, note) => sum + note.durationTicks, 0), 480 * 1_000_000);
  assert.equal(generateIdeaCell('bounded', 'source', { units: 256, count: 256 }).attacks.length, 128);
});

test('an arbitrary argument length cannot create a false metrical downbeat', () => {
  const input = { startTick: 60, endTick: 1060, originTick: 0, gridTicks: 40, pulseTicks: 480, attackBudget: 128 };
  const attacks = subdivideBetweenTargets('partial-span', 'independent-pulse', input);
  // 1000 is the argument's length, but is not a boundary of its 480-tick
  // reference pulse. Formerly span modulo origin mislabeled it a downbeat.
  const falseBoundary = attacks.find(note => note.tick === 1000)!;
  assert.ok(falseBoundary);
  assert.equal(falseBoundary.level, 'subdivision');
  assert.ok(falseBoundary.strength < .78);
  for (const tick of [480, 960]) {
    assert.equal(attacks.find(note => note.tick === tick)?.level, 'pulse');
    assert.equal(attacks.find(note => note.tick === tick)?.strength, .78);
  }
});

test('invalid controls fail explicitly and duplicate structural targets do not consume detail', () => {
  const input = { startTick: 0, endTick: 1920, gridTicks: 60, attackBudget: 10 };
  for (const change of [{ attackBudget: NaN }, { attackBudget: Infinity }, { syncopation: NaN },
    { direction: Infinity }, { hierarchyDecay: NaN }, { pulseTicks: 160.5 }, { originTick: .5 },
    { anchors: [{ tick: 12.5 }] }, { anchors: [{ tick: 120, strength: NaN }] }])
    assert.throws(() => subdivideBetweenTargets('invalid', 'control', { ...input, ...change }), RangeError);
  assert.throws(() => subdivideBetweenTargets('invalid', 'targets', { ...input,
    anchors: Array.from({ length: 129 }, (_, tick) => ({ tick })) }), RangeError);
  assert.throws(() => generateIdeaCell('invalid', 'cell', { complexity: NaN }), RangeError);
  const result = subdivideBetweenTargets('duplicates', 'goals', { ...input,
    anchors: [{ tick: 480, strength: .5 }, { tick: 480, strength: .9 }, { tick: 1920 }, { tick: -60 }] });
  assert.equal(result.length, 10);
  assert.equal(result.find(note => note.tick === 480)?.strength, .9);
  assert.equal(result.filter(note => note.tick === 480).length, 1);
});
