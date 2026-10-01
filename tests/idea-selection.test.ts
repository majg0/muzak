import test from 'node:test';
import assert from 'node:assert/strict';
import { choosePlannedIdea, vocabularyFocus, type IdeaPlan } from '../src/engine/idea-selection';
import { gestureTools, proposeGestures, transformGesture, type Gesture } from '../src/engine/idea-tools';
import { composeThemeCore, realizeThemeCore } from '../src/engine/theme-core';

const vocabulary = ['recall', 'invert', 'fragment', 'connect'];
const plan: IdeaPlan = { scope: 'theme:development', ordinal: 0, vocabulary, maxRegret: .3 };
const candidates = vocabulary.map((tool, index) => ({ id: tool, value: index, tools: [tool], costs: { musical: index * .1 } }));

test('a complete vocabulary gets opportunities over time instead of always choosing the cheapest local answer', () => {
  const used: string[] = [];
  for (let ordinal = 0; ordinal < vocabulary.length * 3; ordinal++) {
    const result = choosePlannedIdea('piece', 'thought:' + ordinal, candidates, { ...plan, ordinal });
    assert.equal(result.coverage!.fulfilled, true);
    assert.equal(result.tools[0], result.coverage!.focus);
    assert.ok(result.cost <= plan.maxRegret + 1e-10);
    used.push(result.tools[0]);
  }
  for (let start = 0; start < used.length; start += vocabulary.length)
    assert.deepEqual(new Set(used.slice(start, start + vocabulary.length)), new Set(vocabulary));
});

test('musical limits defer an unavailable tool without claiming its use or relaxing feasibility', () => {
  const limited = [candidates[0], { ...candidates[1], costs: { musical: 10 } },
    { ...candidates[2], costs: { musical: Infinity } }];
  for (let ordinal = 0; ordinal < vocabulary.length; ordinal++) {
    const result = choosePlannedIdea('piece', 'thought', limited, { ...plan, ordinal }, 100);
    assert.equal(result.id, 'recall');
    assert.deepEqual(result.coverage!.eligible, ['recall']);
    assert.deepEqual(result.coverage!.used, ['recall']);
    assert.deepEqual(result.coverage!.deferred, ['connect', 'fragment', 'invert']);
    assert.equal(result.coverage!.fulfilled, result.coverage!.focus === 'recall');
    assert.equal(result.candidates, 2, 'Diagnostics retain all finite evaluated alternatives.');
  }
});

test('lookahead, candidate order and vocabulary declaration order cannot consume or alter opportunities', () => {
  const run = (ordinal: number, reversed = false) => choosePlannedIdea('piece', 'thought:' + ordinal,
    reversed ? [...candidates].reverse() : candidates,
    { ...plan, ordinal, vocabulary: reversed ? [...vocabulary].reverse() : vocabulary });
  const original = Array.from({ length: 24 }, (_, ordinal) => run(ordinal));
  for (const ordinal of [23, 0, 14, 3, 23, 14, 0]) assert.deepEqual(run(ordinal, true), original[ordinal]);
  assert.deepEqual(candidates.map(candidate => candidate.costs.musical), [0, .1, .2, .30000000000000004]);
});

test('periodic entrances retain the full vocabulary across enclosing cycles', () => {
  for (const stride of [3, 4, 8, 16, 64]) {
    const focuses = new Set(Array.from({ length: 64 }, (_, index) => vocabularyFocus('piece', { ...plan, ordinal: index * stride })));
    assert.deepEqual(focuses, new Set(vocabulary), `Every ${stride}th opportunity must not alias one vocabulary slot.`);
  }
});

test('one composed result can fulfill several tools while every tool keeps its own future opportunity', () => {
  const chain = { id: 'chain', value: 1, tools: ['invert', 'fragment'], costs: { musical: .1 } };
  const result = choosePlannedIdea('piece', 'thought', [chain], { ...plan, vocabulary: ['invert', 'fragment'] });
  assert.deepEqual(result.coverage!.used, ['fragment', 'invert']);
  assert.equal(result.coverage!.fulfilled, true);
});

test('invalid vocabulary plans and invalid musical evaluations fail explicitly', () => {
  for (const patch of [{ ordinal: -1 }, { ordinal: .5 }, { maxRegret: Infinity }, { maxRegret: -1 },
    { scope: '' }, { vocabulary: [] }, { vocabulary: ['a', 'a'] }, { vocabulary: [''] }])
    assert.throws(() => vocabularyFocus('piece', { ...plan, ...patch }), RangeError);
  assert.throws(() => choosePlannedIdea('piece', 'thought', [{ ...candidates[0], costs: { musical: -1 } }], plan), RangeError);
});

test('gesture coverage excludes identity operations and cancelled duration scaling', () => {
  const source: Gesture = { sourceId: 'head', operations: [], notes: [0, 2, 4].map(degree => ({ degree, units: 1, strength: .8 })) };
  assert.deepEqual(gestureTools(source, transformGesture(source, [
    { kind: 'transpose', degrees: 0 }, { kind: 'interval-scale', factor: 1 },
    { kind: 'time-scale', factor: 2 }, { kind: 'time-scale', factor: .5 },
  ])), []);
  assert.deepEqual(gestureTools(source, transformGesture(source, [
    { kind: 'retrograde' }, { kind: 'invert' }, { kind: 'transpose', degrees: -4 },
  ])), [], 'A compound identity cannot be credited as three heard changes.');
  assert.deepEqual(gestureTools(source, transformGesture(source, [
    { kind: 'invert' }, { kind: 'invert' }, { kind: 'transpose', degrees: 1 },
  ])), ['transpose']);
  assert.deepEqual(gestureTools(source, transformGesture(source, [
    { kind: 'invert' }, { kind: 'fragment', start: 1, count: 2 }, { kind: 'transpose', degrees: 3 },
  ])), ['fragment', 'invert', 'transpose']);
});

test('fixed-span rhythm offers proportional shapes without pretending a uniform duration scale is audible', () => {
  const source: Gesture = { sourceId: 'head', operations: [], notes: [0, 2, 4].map(degree => ({ degree, units: 1, strength: .8 })) };
  const context = { from: 0, target: 4, count: 3, development: 1, familiarity: 0, closing: false };
  const absolute = proposeGestures(source, context), relative = proposeGestures(source, { ...context, durationMode: 'relative' });
  assert.ok(absolute.some(candidate => candidate.gesture.operations.some(operation => operation.kind === 'time-scale')));
  assert.ok(relative.length < absolute.length);
  assert.ok(relative.every(candidate => candidate.gesture.operations.every(operation => operation.kind !== 'time-scale')));
  const signatures = relative.map(candidate => JSON.stringify(candidate.gesture.notes));
  assert.equal(new Set(signatures).size, signatures.length, 'Equivalent transforms compete only once.');
});

test('a developing medium-density thought visits its source replies over time without lengthening each argument', () => {
  const core = composeThemeCore('glass-garden', 'theme-a', 4), heard = new Set<string>();
  const replies = core.clauses.slice(1, -1).map(clause => clause.sourceId);
  for (let occurrence = 1; occurrence <= 36; occurrence++) {
    const sentence = realizeThemeCore(core, { startTick: 0, endTick: 7680, tuning: '12tet', occurrence,
      cadence: 'closed', treatment: 'develop', development: { literal: false, amount: 1, familiarity: 0, selection: .5 },
      argument: { seed: 'glass-garden', ideaDensity: .5, activity: .5, register: .5 } });
    assert.equal(sentence.segments.length, 3);
    assert.equal(sentence.notes.at(-1)!.degree, 0);
    assert.deepEqual(sentence.segments[0].notes.map(note => note.degree), core.clauses[0].notes.map(note => note.degree));
    const coverage = sentence.realization!.sourceCoverage!;
    coverage.used.forEach(id => heard.add(id));
    assert.ok(coverage.used.every(id => replies.includes(id)));
  }
  assert.deepEqual(heard, new Set(replies));
});
