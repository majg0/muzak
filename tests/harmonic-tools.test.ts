import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_HARMONY } from '../src/harmonic-language';
import { DEFAULT_PARAMETERS, DEFAULT_WEIGHTS } from '../src/parameters';
import { degreeToPitch, type TuningId } from '../src/pitch';
import { DEFAULT_SOUND } from '../src/spectrum';
import { FRAME_TICKS } from '../src/types';
import { harmonicDestinationAt, harmonicPitchClasses, harmonicRealization, harmonicSequenceOffset, harmonicVocabulary, proposeHarmonicRoutes,
  harmonicWindowTicks, planHarmonicRoute, transformTriad, type HarmonicRouteInput } from '../src/engine/harmonic-tools';
import { plan, type HarmonicState } from '../src/engine/planner';
import { initialEdo19State, planEdo19, validEdo19Voices } from '../src/engine/edo19';
import { createRoughnessScorer } from '../src/engine/roughness-scoring';
import { validVoices } from '../src/engine/analysis';
import type { PlanningIntent } from '../src/engine/intent';
import { weightedLyricalNeighborPenalty } from '../src/engine/lyrical-support';

const input = (tuning: TuningId = '12tet'): HarmonicRouteInput => ({ seed: 'harmonic-argument', phraseId: 'theme-a:0',
  themeId: 'theme-a', occurrence: 0, startTick: 0, endTick: 15360, barTicks: 1920, tuning,
  center: 0, third: 4, cadence: 'closed', config: { ...DEFAULT_HARMONY } });

test('P/R/L are native involutions preserving exactly two triad tones', () => {
  for (const tuning of ['12tet', '19edo'] as const) for (const quality of ['major', 'minor'] as const)
    for (const operation of ['P', 'R', 'L'] as const) for (let root = 0; root < (tuning === '12tet' ? 12 : 19); root++) {
      const transformed = transformTriad(root, quality, operation, tuning);
      assert.deepEqual(transformTriad(transformed.root, transformed.quality, operation, tuning), { root, quality });
      const before = harmonicPitchClasses(root, quality, tuning), after = harmonicPitchClasses(transformed.root, transformed.quality, tuning);
      assert.equal(before.filter(pitch => after.includes(pitch)).length, 2);
    }
});

test('shared sequence regions close after three occurrences on declared native anchors', () => {
  for (const tuning of ['12tet', '19edo'] as const) {
    const config = { ...DEFAULT_HARMONY, treatment: 'sequence' as const };
    const offsets = Array.from({ length: 7 }, (_, occurrence) => harmonicSequenceOffset('sequence', 'theme-a', occurrence, tuning, config));
    assert.deepEqual(offsets.slice(0, 3).sort((a, b) => a - b), tuning === '12tet' ? [0, 4, 8] : [0, 6, 12]);
    assert.equal(offsets[0], 0); assert.equal(offsets[3], 0); assert.equal(offsets[6], 0);
    assert.deepEqual(offsets.slice(0, 3), offsets.slice(3, 6));
    for (const treatment of ['develop', 'reharmonize'] as const) assert.equal(harmonicSequenceOffset('sequence', 'theme-a', 2, tuning, { ...config, treatment }), 0);
  }
});

test('routes cover whole arguments, reserve real preparations, and evaluate the complete cadence vocabulary', () => {
  for (const tuning of ['12tet', '19edo'] as const) {
    const cadences = new Set<string>(), signatures = new Set<string>();
    const fifth = tuning === '12tet' ? 7 : 11, fourth = tuning === '12tet' ? 5 : 8, sixth = tuning === '12tet' ? 9 : 14;
    for (let seed = 0; seed < 48; seed++) for (const cadence of ['open', 'closed'] as const) {
      const args = { ...input(tuning), seed: `route-${seed}`, cadence };
      const route = planHarmonicRoute(args), tail = route.destinations.slice(-2);
      assert.deepEqual(route, planHarmonicRoute(args));
      assert.equal(route.destinations[0].startTick, 0); assert.equal(route.destinations.at(-1)!.endTick, 15360);
      for (let tick = 0; tick < 15360; tick += FRAME_TICKS) assert.ok(harmonicDestinationAt(route, tick));
      assert.equal(harmonicDestinationAt(route, 15360), undefined, 'Never borrow the previous phrase plan beyond its declared span.');
      assert.ok(tail.every(goal => goal.cadence === route.cadence));
      if (route.cadence === 'authentic') assert.deepEqual(tail.map(goal => goal.root), [fifth, 0]);
      if (route.cadence === 'plagal') assert.deepEqual(tail.map(goal => goal.root), [fourth, 0]);
      if (route.cadence === 'half') assert.equal(tail[1].root, fifth);
      if (route.cadence === 'deceptive') assert.deepEqual(tail.map(goal => goal.root), [fifth, sixth]);
      assert.notEqual(route.cadence, null);
      proposeHarmonicRoutes(args).forEach(candidate => { if (candidate.value.cadence) cadences.add(candidate.value.cadence); });
      signatures.add(route.destinations.map(goal => `${goal.root}/${goal.quality}`).join(','));
    }
    assert.equal(cadences.size, 4); assert.ok(signatures.size >= 12, `Route alternatives actually differ: ${signatures.size}`);
  }
});

test('a four-bar seven-eight statement never claims a cadence it cannot prepare', () => {
  const route = planHarmonicRoute({ ...input(), barTicks: 1680, endTick: 6720 });
  assert.equal(route.destinations.length, 1);
  assert.equal(route.cadence, null); assert.equal(route.destinations[0].cadence, null);
  assert.equal(route.destinations[0].operation, 'tonic statement');
});

test('short thoughts retain each language through an actual relation without inflating harmonic pace', () => {
  for (const tuning of ['12tet', '19edo'] as const) for (const cadence of ['open', 'closed'] as const) {
    const startTick = 4800, endTick = startTick + 3840;
    const routes = (['functional', 'tonnetz', 'third-cycle'] as const).map(strategy => planHarmonicRoute({ ...input(tuning),
      startTick, endTick, cadence, config: { ...DEFAULT_HARMONY, strategy } }));
    assert.equal(new Set(routes.map(route => route.destinations.map(goal => goal.pitchClasses.join(',')).join('/'))).size, 3);
    for (const route of routes) assert.deepEqual(route.destinations.map(goal => [goal.startTick, goal.endTick]),
      [[startTick, startTick + 1920], [startTick + 1920, endTick]]);
    const [functional, commonTone, thirdCycle] = routes;
    assert.ok(functional.cadence);
    assert.equal(commonTone.cadence, null); assert.equal(thirdCycle.cadence, null);
    assert.equal(commonTone.destinations[0].pitchClasses.filter(pitch => commonTone.destinations[1].pitchClasses.includes(pitch)).length, 2);
    assert.ok(commonTone.destinations[1].operation.endsWith('common-tone relation'));
    assert.notEqual(thirdCycle.destinations[0].root, thirdCycle.destinations[1].root);
    if (cadence === 'closed') for (const route of routes) assert.equal(route.destinations.at(-1)!.root, 0);
    for (const strategy of ['tonnetz', 'third-cycle'] as const) {
      const single = planHarmonicRoute({ ...input(tuning), startTick, endTick: startTick + 960, cadence,
        config: { ...DEFAULT_HARMONY, strategy } });
      assert.equal(single.destinations.length, 1); assert.equal(single.cadence, null);
      if (cadence === 'closed') assert.equal(single.destinations[0].root, 0);
    }
  }
});

test('balanced short thoughts evaluate departure and functional intent before choosing a truthful harmonic relation', () => {
  for (const tuning of ['12tet', '19edo'] as const) {
    let quietCadences = 0, strongCadences = 0;
    for (let seed = 0; seed < 16; seed++) {
      const args = { ...input(tuning), seed: `short-balanced-${seed}`, phraseId: 'short', endTick: 3840 };
      const plan = (harmonicColor: number, cadenceStrength: number) => planHarmonicRoute({ ...args,
        config: { ...DEFAULT_HARMONY, harmonicColor, cadenceStrength } });
      const plain = plan(0, 1), related = plan(.45, 0), direct = plan(.45, 1), remote = plan(.8, 0);
      assert.ok(plain.cadence, 'A functional route remains available without color.');
      assert.equal(related.cadence, null);
      assert.ok(related.destinations[1].operation.endsWith('common-tone relation'));
      assert.equal(related.destinations[0].pitchClasses.filter(pitch => related.destinations[1].pitchClasses.includes(pitch)).length, 2);
      assert.equal(remote.cadence, null); assert.equal(remote.destinations[0].operation, 'third-cycle region');
      quietCadences += Number(related.cadence !== null); strongCadences += Number(direct.cadence !== null);
      for (const route of [plain, related, direct, remote]) {
        assert.deepEqual(route.destinations.map(goal => [goal.startTick, goal.endTick]), [[0, 1920], [1920, 3840]]);
        assert.equal(route.destinations.at(-1)!.root, 0);
        assert.ok(route.destinations.every(goal => goal.cadence === route.cadence));
      }
      const three = planHarmonicRoute({ ...args, endTick: 5760, config: { ...DEFAULT_HARMONY, harmonicColor: .45, cadenceStrength: 1 } });
      assert.equal(three.destinations.length, 3); assert.ok(three.cadence);
      assert.ok(three.destinations[0].operation.endsWith('related-tonic substitute'));
      assert.equal(three.destinations[0].cadence, null);
      assert.ok(three.destinations.slice(-2).every(goal => goal.cadence === three.cadence));
    }
    assert.ok(strongCadences > quietCadences, 'Stronger cadence intent can outweigh the same color preference.');
    const fifth = tuning === '12tet' ? 7 : 11;
    const prepared = planHarmonicRoute({ ...input(tuning), seed: 'supported-cadence', phraseId: 'short', endTick: 3840,
      config: { ...DEFAULT_HARMONY, harmonicColor: .8 },
      melodyAnchorsAt: tick => harmonicPitchClasses(tick ? 0 : fifth, tick ? 'major' : 'dominant', tuning)
        .map(degree => ({ cents: tuning === '12tet' ? 6000 + degree * 100 : degreeToPitch(tuning, degree).millicents / 1000, weight: 1 })) });
    assert.equal(prepared.cadence, 'authentic', 'A supported functional melody can outweigh even a strong departure preference.');
    assert.deepEqual(prepared.destinations.map(goal => goal.root), [fifth, 0]);
    assert.ok(prepared.destinations.every(goal => goal.melodyFit === 1));
  }
});

test('committed harmonic opportunities use the eligible toolkit over time within an evaluated cost budget', () => {
  for (const tuning of ['12tet', '19edo'] as const) {
    const config = { ...DEFAULT_HARMONY, harmonicColor: .55 }, vocabulary = harmonicVocabulary(config);
    const seen = new Set<string>();
    for (const cadence of ['open', 'closed'] as const) for (let ordinal = 0; ordinal < vocabulary.length; ordinal++) {
      const args = { ...input(tuning), seed: 'planned-harmony', phraseId: `heard-${ordinal}`, occurrence: ordinal, cadence, config,
        plan: { scope: `theme-a:${tuning}`, ordinal, vocabulary, maxRegret: .6 } };
      const chosen = planHarmonicRoute(args), baseline = planHarmonicRoute({ ...args, plan: undefined });
      const cost = (route: typeof chosen) => Object.values(route.evaluation!).reduce((sum, value) => sum + value, 0);
      assert.ok(cost(chosen) <= cost(baseline) + args.plan.maxRegret + 1e-10);
      assert.ok(chosen.candidatesEvaluated! > 1);
      assert.deepEqual([...chosen.tools!].sort(), chosen.coverage!.used);
      assert.ok(chosen.tools!.every(tool => chosen.coverage!.eligible.includes(tool)));
      chosen.tools!.forEach(tool => seen.add(tool));
      // Query a later occurrence first. Neither lookahead nor recomputation
      // consumes or resets this committed opportunity.
      planHarmonicRoute({ ...args, occurrence: ordinal + vocabulary.length, plan: { ...args.plan, ordinal: ordinal + vocabulary.length } });
      assert.deepEqual(chosen, planHarmonicRoute(args));
      const endings = chosen.destinations.slice(-2);
      assert.ok(endings.every(goal => goal.cadence === chosen.cadence));
      if (cadence === 'closed') assert.equal(endings.at(-1)!.root, 0);
    }
    assert.deepEqual([...seen].sort(), [...vocabulary].sort(), 'All compatible declared techniques receive heard opportunities across open and closed arguments.');
    const impossible = planHarmonicRoute({ ...input(tuning), endTick: 960, cadence: 'closed', config,
      plan: { scope: 'one-held-tonic', ordinal: 0, vocabulary: ['P'], maxRegret: 100 } });
    assert.equal(impossible.destinations.length, 1); assert.equal(impossible.destinations[0].root, 0);
    assert.equal(impossible.cadence, null); assert.equal(impossible.coverage!.fulfilled, false);
    assert.deepEqual(impossible.coverage!.deferred, ['P']);
    assert.deepEqual(impossible.tools, [], 'A tool is credited only for an actual use, never merely for being requested.');
  }
});

test('explicit harmonic languages constrain the candidate catalogue before temporal selection', () => {
  for (const strategy of ['functional', 'tonnetz', 'third-cycle'] as const) {
    const config = { ...DEFAULT_HARMONY, strategy, harmonicColor: 1 }, vocabulary = harmonicVocabulary(config);
    for (const candidate of proposeHarmonicRoutes({ ...input(), config })) {
      assert.ok(candidate.tools.every(tool => vocabulary.includes(tool as never)));
      assert.ok(Object.values(candidate.costs).every(value => Number.isFinite(value) && value >= 0));
      if (strategy === 'functional') assert.ok(!candidate.tools.some(tool => ['P', 'R', 'L', 'third-cycle'].includes(tool)));
      if (strategy === 'tonnetz') assert.ok(!candidate.tools.includes('third-cycle') && !candidate.tools.includes('secondary-dominant'));
      if (strategy === 'third-cycle') assert.ok(!candidate.tools.some(tool => ['P', 'R', 'L', 'secondary-dominant'].includes(tool)));
    }
  }
});

test('a three-window thought can begin with a secondary dominant and discharge both resolutions', () => {
  for (const tuning of ['12tet', '19edo', '24edo', '31edo'] as const) {
    const config = { ...DEFAULT_HARMONY, strategy: 'functional' as const, harmonicColor: .6 };
    const args = { ...input(tuning), endTick: 5760, config };
    const candidates = proposeHarmonicRoutes(args);
    const secondary = candidates.filter(candidate => candidate.tools.includes('secondary-dominant'));
    assert.ok(secondary.length > 0);
    const fifth = { '12tet': 7, '19edo': 11, '24edo': 14, '31edo': 18 }[tuning];
    const second = { '12tet': 2, '19edo': 3, '24edo': 4, '31edo': 5 }[tuning];
    for (const candidate of secondary) {
      assert.deepEqual(candidate.value.destinations.map(goal => goal.root), [second, fifth, 0]);
      assert.deepEqual(candidate.value.destinations.map(goal => goal.quality), ['dominant', 'dominant', 'major']);
      assert.equal(candidate.value.cadence, 'authentic');
      assert.equal(candidate.value.destinations[0].operation, 'secondary dominant of V');
      assert.equal(candidate.value.destinations[0].cadence, null);
    }
    const planned = planHarmonicRoute({ ...args, plan: { scope: 'short-authentic', ordinal: 0, vocabulary: ['secondary-dominant'], maxRegret: .6 } });
    assert.equal(planned.coverage!.fulfilled, true);
    assert.equal(planned.destinations.length, 3, 'The available relation never needs a faster harmonic clock.');
  }
});

test('cadence scopes give each relevant closing technique its own committed opportunity cycle', () => {
  const config = { ...DEFAULT_HARMONY, harmonicColor: .55 };
  for (const cadence of ['open', 'closed'] as const) {
    const vocabulary = harmonicVocabulary(config, cadence), used = new Set<string>();
    const incompatible = cadence === 'closed' ? ['half', 'deceptive'] : ['authentic', 'plagal'];
    assert.ok(incompatible.every(tool => !vocabulary.includes(tool as never)));
    for (let ordinal = 0; ordinal < vocabulary.length; ordinal++) {
      const route = planHarmonicRoute({ ...input(), seed: 'cadence-context', cadence, config,
        plan: { scope: `harmony:12tet:${cadence}`, ordinal, vocabulary, maxRegret: .6 } });
      route.tools!.forEach(tool => used.add(tool));
    }
    assert.deepEqual([...used].sort(), [...vocabulary].sort());
  }
});

test('harmonic search rejects unbounded clocks before allocating windows or reading melodic context', () => {
  let reads = 0;
  const args = { ...input(), melodyAnchorsAt: () => { reads++; return []; } };
  for (const patch of [{ endTick: 1920 * 128 + 1 }, { barTicks: 1, endTick: 1e9 },
    { barTicks: Number.MAX_SAFE_INTEGER }, { barTicks: 0 }, { endTick: Infinity }]) {
    assert.throws(() => proposeHarmonicRoutes({ ...args, ...patch }), RangeError);
  }
  assert.equal(reads, 0);
  assert.ok(proposeHarmonicRoutes({ ...args, endTick: 5760 }).length > 0);
  assert.equal(reads, 3);
});

test('actual overlap weights change melodic fit and route while zero-weight targets have no influence', () => {
  const common = { ...input(), seed: 'weighted-argument' };
  const sustained = planHarmonicRoute({ ...common, melodyAnchorsAt: () => [{ cents: 6800, weight: 10 }, { cents: 6900, weight: 1 }] });
  const fleeting = planHarmonicRoute({ ...common, melodyAnchorsAt: () => [{ cents: 6800, weight: 1 }, { cents: 6900, weight: 10 }] });
  assert.notDeepEqual(sustained.destinations.map(goal => [goal.root, goal.quality]), fleeting.destinations.map(goal => [goal.root, goal.quality]));
  const single = planHarmonicRoute({ ...common, melodyAnchorsAt: () => [{ cents: 6800, weight: 10 }] });
  const zero = planHarmonicRoute({ ...common, melodyAnchorsAt: () => [{ cents: 6800, weight: 10 }, { cents: 6900, weight: 0 }] });
  assert.deepEqual(single, zero);
  assert.equal(weightedLyricalNeighborPenalty([6100, 6600, 6900, 7800], [{ cents: 6800, weight: 5 }, { cents: 7200, weight: 1 }]), 5 / 6);
});

test('weighted sustained obligations select a less cramped actual voicing without moving the tune or changing chord identity', () => {
  const destination = planHarmonicRoute({ ...input(), center: 6, third: 3,
    config: { ...DEFAULT_HARMONY, strategy: 'functional' } }).destinations[0];
  const state: HarmonicState = { voices: [57, 64, 69, 76], bass: 42, center: 6, index: 1, recent: [] };
  const parameters = { ...DEFAULT_PARAMETERS, voiceLeading: .99, tonalClarity: .96, dissonance: .06 };
  const anchors = [{ cents: 6800, weight: 5 }];
  const realize = (weighted: boolean) => plan('held-line', state, () => parameters, DEFAULT_WEIGHTS, undefined,
    index => ({ targetTension: .2, lyrical: true, harmonicDestination: destination, holdHarmony: index > 1,
      tonalCenter12: 6, homeThird: 3, melodyTargetsCents: [6800], ...(weighted ? { melodyAnchors: anchors } : {}) })).winner.state;
  const ordinary = realize(false), weighted = realize(true);
  assert.ok(harmonicRealization(destination, weighted.voices, weighted.bass, '12tet').matched);
  assert.equal(weightedLyricalNeighborPenalty(ordinary.voices.map(pitch => pitch * 100), anchors), 1);
  assert.equal(weightedLyricalNeighborPenalty(weighted.voices.map(pitch => pitch * 100), anchors), 0);
  assert.ok(weighted.voices.every((pitch, voice) => Math.abs(pitch - state.voices[voice]) <= 3));
  assert.deepEqual(anchors, [{ cents: 6800, weight: 5 }]);
});

test('protected whole-window melody influences route selection without editing its targets', () => {
  const args = input(), targets = [6400, 6900, 6500, 6500, 6900, 6200, 7100, 7200];
  const withMelody = planHarmonicRoute({ ...args, melodyTargetsAt: tick => [targets[Math.floor(tick / 1920)]] });
  assert.ok(withMelody.destinations.every(goal => goal.melodyFit >= 0 && goal.melodyFit <= 1));
  const swapped = planHarmonicRoute({ ...args, melodyTargetsAt: tick => [targets[Math.floor(tick / 1920)] + 100] });
  assert.notDeepEqual(withMelody.destinations.map(goal => goal.melodyFit), swapped.destinations.map(goal => goal.melodyFit));
  assert.notDeepEqual(withMelody.destinations.map(goal => [goal.root, goal.quality]), swapped.destinations.map(goal => [goal.root, goal.quality]),
    'Protecting a different whole melody must change the chosen route, not only its reported fit.');
  assert.deepEqual(targets, [6400, 6900, 6500, 6500, 6900, 6200, 7100, 7200]);
});

test('balanced routes only claim real common-tone relations and discharge functional obligations before switching language', () => {
  for (const tuning of ['12tet', '19edo'] as const) for (let seed = 0; seed < 96; seed++) {
    const route = planHarmonicRoute({ ...input(tuning), seed: `mixed-language-${seed}`, third: seed % 2 ? 3 : 4,
      config: { ...DEFAULT_HARMONY, harmonicColor: 1 }, melodyTargetsAt: tick => [6000 + (Math.floor(tick / 1920) * 3 + seed) % 12 * 100] });
    route.destinations.slice(1).forEach((current, index) => {
      const previous = route.destinations[index];
      if (current.operation.endsWith('common-tone relation')) {
        assert.ok(previous.quality === 'major' || previous.quality === 'minor');
        assert.equal(previous.pitchClasses.filter(pitch => current.pitchClasses.includes(pitch)).length, 2);
      }
      if (current.cadence) return; // Final preparations intentionally join the cadence route.
      if (previous.quality === 'diminished') assert.equal(current.operation, 'diminished predominant resolution');
      if (previous.operation === 'secondary dominant of V') assert.equal(current.operation, 'secondary dominant resolution');
      else if (previous.quality === 'dominant') {
        assert.equal(current.root, previous.region);
        assert.equal(current.operation, previous.operation === 'third-cycle dominant' ? 'third-cycle arrival' : 'dominant resolution');
      }
    });
  }
});

test('higher harmonic direction commits only complete true bars, including odd meters', () => {
  for (const barTicks of [1440, 1920, 2400, 1680]) {
    const span = harmonicWindowTicks(barTicks, DEFAULT_HARMONY);
    assert.equal(span % barTicks, 0); assert.equal(span % FRAME_TICKS, 0);
  }
  assert.equal(harmonicWindowTicks(1920, DEFAULT_HARMONY), 1920);
  assert.equal(harmonicWindowTicks(1920), 3840);
  assert.equal(harmonicWindowTicks(1920, { ...DEFAULT_HARMONY, functionalMotion: .1 }), 3840);
});

test('every strategy produces its declared native chord and bass identity, with exact structural holds', () => {
  const p = { ...DEFAULT_PARAMETERS, voiceLeading: .98, dissonance: .12, tonalClarity: .95 };
  for (const tuning of ['12tet', '19edo'] as const) for (const strategy of ['functional', 'tonnetz', 'third-cycle'] as const) {
    const route = planHarmonicRoute({ ...input(tuning), config: { ...DEFAULT_HARMONY, strategy, harmonicColor: .8 } });
    const intent = (index: number): PlanningIntent => {
      const tick = index * FRAME_TICKS, destination = harmonicDestinationAt(route, tick);
      return { targetTension: .2, lyrical: true, harmonicDestination: destination,
        holdHarmony: !destination || tick !== destination.startTick, tonalCenter12: 0, centerDegree19: 0, homeThird: 4 };
    };
    let state: HarmonicState = { voices: [48, 55, 64, 72], bass: 36, center: 0, index: 0, recent: [] };
    let native = initialEdo19State('functional-audit');
    const scorer = createRoughnessScorer(DEFAULT_SOUND, degree => degreeToPitch('19edo', degree));
    const roots = new Set<number>(), sonorities = new Set<string>();
    let maximumStep = 0, changedTogether = 0;
    for (let index = 0; index < 16; index++) {
      const old = tuning === '12tet' ? state.voices : native.upperDegrees;
      const previousBass = tuning === '12tet' ? state.bass : native.bassDegree;
      if (tuning === '12tet') state = plan('functional-audit', state, () => p, DEFAULT_WEIGHTS, undefined, intent).winner.state;
      else native = planEdo19('functional-audit', native, () => p, DEFAULT_WEIGHTS, scorer, intent).winner.state;
      const upper = tuning === '12tet' ? state.voices : native.upperDegrees, bass = tuning === '12tet' ? state.bass : native.bassDegree;
      assert.ok(tuning === '12tet' ? validVoices(upper) : validEdo19Voices(upper));
      const goal = harmonicDestinationAt(route, index * FRAME_TICKS)!;
      assert.ok(harmonicRealization(goal, upper, bass, tuning).matched, `${tuning} ${strategy} ${index} must realize ${goal.operation}`);
      if (index % 2) { assert.deepEqual(upper, old); assert.equal(bass, previousBass); }
      else {
        roots.add(goal.root); sonorities.add(`${upper}/${bass}`);
        changedTogether = Math.max(changedTogether, upper.filter((pitch, voice) => pitch !== old[voice]).length);
        if (index > 0) maximumStep = Math.max(maximumStep, ...upper.map((pitch, voice) => Math.abs(pitch - old[voice]) * 1200 / (tuning === '12tet' ? 12 : 19)));
      }
    }
    assert.ok(roots.size >= 3 && sonorities.size >= 4, `${tuning} ${strategy} must actually travel.`);
    assert.ok(changedTogether >= 3, 'Smoothness must allow several voices to move together.');
    assert.ok(maximumStep <= 500, `${tuning} ${strategy} bounded nearest motion: ${maximumStep}`);
  }
});
