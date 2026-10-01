import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseIdea, IdeaGraph, spectrumAt, spectrumHierarchy, SPECTRUM_AXES } from '../src/engine/idea-graph';
import { composeThemeCore, realizeThemeCore } from '../src/engine/theme-core';

test('shared DAG ancestors contribute once; separate idea sets remain local and can isolate inheritance', () => {
  const definition = { sets: [
    { id: 'subject', ideas: [{ id: 'head', value: { degree: 0 } }] },
    { id: 'answer-set', ideas: [{ id: 'answer', value: { degree: 4 } }] },
    { id: 'private-set', ideas: [{ id: 'private', value: { degree: 2 } }] },
  ], scopes: [
    { id: 'piece', sets: ['subject'] },
    { id: 'question', parents: ['piece'] },
    { id: 'answer', parents: ['piece'], sets: ['answer-set'] },
    { id: 'phrase', parents: ['question', 'answer'], sets: ['subject'] },
    { id: 'separate', parents: ['piece'], sets: ['private-set'], inherit: false },
  ] };
  const graph = new IdeaGraph(definition), phrase = graph.resolve('phrase');
  assert.deepEqual(phrase.map(idea => idea.id), ['answer', 'head']);
  assert.deepEqual(phrase.find(idea => idea.id === 'head')!.owners, ['phrase', 'piece']);
  assert.deepEqual(graph.resolve('question').map(idea => idea.id), ['head']);
  assert.deepEqual(graph.resolve('separate').map(idea => idea.id), ['private']);
  definition.sets[0].ideas[0].value.degree = 99;
  phrase[0].value.degree = 88;
  assert.equal(graph.resolve('piece')[0].value.degree, 0);
  assert.equal(graph.resolve('phrase')[0].value.degree, 4);
  assert.deepEqual(new IdeaGraph({ ...definition, scopes: [...definition.scopes].reverse() }).resolve('separate'), graph.resolve('separate'));
});

test('invalid references, cycles including isolated structural parents, and duplicate identities fail before generation', () => {
  assert.throws(() => new IdeaGraph({ sets: [], scopes: [{ id: 'a', parents: ['b'] }] }), /Unknown idea scope/);
  assert.throws(() => new IdeaGraph({ sets: [], scopes: [{ id: 'a', sets: ['b'] }] }), /Unknown idea set/);
  assert.throws(() => new IdeaGraph({ sets: [], scopes: [{ id: 'a', parents: ['b'], inherit: false }, { id: 'b', parents: ['a'] }] }), /Cyclic/);
  assert.throws(() => new IdeaGraph({ sets: [{ id: 's', ideas: [{ id: 'x', value: 1 }, { id: 'x', value: 2 }] }], scopes: [] }), /Duplicate/);
});

test('deep valid idea inheritance does not depend on the JavaScript call-stack limit', () => {
  const scopes = Array.from({ length: 10_000 }, (_, i) => ({ id: `scope-${i}`, parents: i ? [`scope-${i - 1}`] : [], sets: i ? [] : ['source'] }));
  const graph = new IdeaGraph({ sets: [{ id: 'source', ideas: [{ id: 'subject', value: 1 }] }], scopes });
  assert.deepEqual(graph.resolve('scope-9999').map(idea => idea.id), ['subject']);
});

test('evaluated choice is order independent, rejects infeasible paths and exponentially favors better musical costs', () => {
  const candidates = [
    { id: 'prepared', value: 0, costs: { motion: 0 } },
    { id: 'distant', value: 1, costs: { motion: 2 } },
    { id: 'impossible', value: 2, costs: { motion: Infinity } },
  ];
  let prepared = 0;
  for (let index = 0; index < 1024; index++) {
    const seed = `evaluated-${index}`, result = chooseIdea(seed, 'phrase', candidates, 1);
    assert.deepEqual(result, chooseIdea(seed, 'phrase', [...candidates].reverse(), 1));
    assert.equal(result.candidates, 2);
    if (result.id === 'prepared') prepared++;
    assert.equal(chooseIdea(seed, 'phrase', candidates).id, 'prepared');
  }
  assert.ok(prepared > 850 && prepared < 950, `${prepared}/1024 should approximate 1 / (1 + exp(-2))`);
  assert.throws(() => chooseIdea('s', 'p', [{ id: 'x', value: 1, costs: { invalid: NaN } }]), /costs/);
  assert.throws(() => chooseIdea('s', 'p', []), /feasible/);
});

test('multiscale spectra are continuous, query independent, bounded and increasingly subordinate', () => {
  const graph = spectrumHierarchy('nested-story', 'piece', 5);
  for (const phase of [0, .125, .25, .37, .5, .875, 1]) {
    const first = spectrumAt(graph, 'piece', phase, 5);
    spectrumAt(graph, 'piece', 1 - phase, 5);
    assert.deepEqual(spectrumAt(graph, 'piece', phase, 5), first);
    for (const axis of SPECTRUM_AXES) {
      assert.ok(first[axis] >= 0 && first[axis] <= 1);
      const near = spectrumAt(graph, 'piece', phase + 1e-8, 5);
      assert.ok(Math.abs(first[axis] - near[axis]) < 1e-6);
      for (let level = 1; level <= 5; level++) {
        const low = spectrumAt(graph, 'piece', phase, level - 1), high = spectrumAt(graph, 'piece', phase, level);
        assert.ok(Math.abs(high[axis] - low[axis]) <= .5 * 2 ** -level + 1e-12);
      }
    }
  }
  assert.throws(() => spectrumHierarchy('s', 'p', 99), RangeError);
});

test('the production theme compiler resolves scope membership, preserves shared identity and realizes isolated arguments', () => {
  const core = composeThemeCore('scoped-argument', 'an-arbitrary-source', 4);
  const input = { startTick: 0, endTick: 15360, tuning: '19edo' as const, occurrence: 0, cadence: 'closed' as const, treatment: 'reharmonize' as const };
  const full = realizeThemeCore(core, input), close = core.clauses.at(-1)!;
  core.ideaGraph!.scopes = [...core.ideaGraph!.scopes, { id: 'short-recall', parents: [core.id], inherit: false,
    sets: [`${core.headId}:set`, `${close.sourceId}:set`] }];
  const shorter = realizeThemeCore(core, { ...input, ideaScope: 'short-recall' });
  assert.equal(shorter.segments.length, 2);
  assert.ok(full.segments.length > shorter.segments.length);
  assert.deepEqual(shorter.segments[0].notes.map(note => note.degree), full.segments[0].notes.map(note => note.degree));
  assert.equal(shorter.notes.at(-1)!.degree, 0);
  assert.ok(shorter.notes.every(note => note.tick >= 0 && note.tick + note.duration <= input.endTick));
  assert.throws(() => realizeThemeCore(core, { ...input, ideaScope: 'missing' }), /Unknown/);
  const legacy = { ...core, ideaGraph: undefined, ideaScope: undefined };
  assert.throws(() => realizeThemeCore(legacy, { ...input, ideaScope: 'missing' }), /requires an idea graph/);
  assert.throws(() => realizeThemeCore(core, { ...input, startTick: Number.MAX_SAFE_INTEGER - 15359, endTick: Number.MAX_SAFE_INTEGER + 1 }), RangeError);
  assert.throws(() => realizeThemeCore(core, { ...input, beatTicks: NaN }), /pulse/);
});

test('a large available vocabulary does not overfill a short sparse thought', () => {
  const core = composeThemeCore('large-palette', 'theme-a', 4);
  const template = core.clauses.at(-1)!;
  core.clauses = [core.clauses[0], ...Array.from({ length: 24 }, (_, index) => ({ ...structuredClone(template),
    id: `reply-${index}`, sourceId: `reply-${index}` }))];
  core.ideaGraph = undefined; core.ideaScope = undefined;
  const line = realizeThemeCore(core, { startTick: 0, endTick: 3840, tuning: '12tet', occurrence: 0,
    cadence: 'closed', treatment: 'reharmonize', argument: { seed: 'large-palette', ideaDensity: 0, activity: .2, register: .5 } });
  assert.equal(line.segments.length, 2);
  assert.equal(line.segments.at(-1)!.sourceId, 'reply-23');
  assert.equal(line.notes.at(-1)!.degree, 0);
  assert.ok(line.notes.every(note => note.tick + note.duration <= 3840));
});
