import test from 'node:test';
import assert from 'node:assert/strict';
import { callCoreSync as call } from '../src/core/sync';
import type { Score } from '../src/core/generated/Score';
import type { ProgressionOptions } from '../src/core/generated/ProgressionOptions';
import type { MotionChord } from '../src/core/generated/MotionChord';
import type { HarmonicConnectionOptions } from '../src/core/generated/HarmonicConnectionOptions';
import type { HarmonicLinesAnalysis } from '../src/core/generated/HarmonicLinesAnalysis';
import type { CompositionPlan } from '../src/core/generated/CompositionPlan';
import type { HarmonicMotionOptions } from '../src/core/generated/HarmonicMotionOptions';

const SEMITONE = 100000;
const OCTAVE = 12 * SEMITONE;
const sorted = (values: number[]) => [...values].sort((a, b) => a - b);
const chord = (id: string, pitches: number[]): MotionChord => ({
  id, name: id, pitchesMillicents: pitches.map(pitch => pitch * SEMITONE),
  rootMillicents: pitches[0] * SEMITONE,
});

function options(patch: Partial<ProgressionOptions> = {}): ProgressionOptions {
  return { ...call('getProgressionDefaults', {}).options, ...patch };
}

function connection(patch: Partial<HarmonicConnectionOptions> = {}): HarmonicConnectionOptions {
  return {
    chords: [chord('from', [60]), chord('middle', [64]), chord('to', [68])],
    fromChordId: 'from', toChordId: 'to', intermediateChordIds: null, periodMillicents: OCTAVE, context: null,
    geometry: 'registered',
    weights: { motionLinear: 0, motionSquared: 1, addedMembers: 1, chromaticEntry: 0,
      collectionExposure: 0, sonorityExposure: 0, insertion: 1 },
    sourceDuration: { numerator: 4, denominator: 1 },
    destinationDuration: { numerator: 4, denominator: 1 }, maxIntermediates: 3,
    ...patch,
  };
}

function events(score: Score) {
  return score.notes.map(note => [note.onset / score.ppq, note.duration / score.ppq,
    note.pitch.millicents, note.velocity, note.releaseVelocity])
    .sort((a, b) => a[0] - b[0] || a[2] - b[2]);
}

function routedEvents(score: Score) {
  return score.notes.map(note => JSON.stringify([note.part, note.onset / score.ppq,
    note.duration / score.ppq, note.pitch, note.velocity, note.releaseVelocity,
    note.pitchEnvelope, note.gainEnvelope])).sort();
}

function assertLinePartition(passage: {
  lines: HarmonicLinesAnalysis, linePlans: CompositionPlan[], plan: CompositionPlan,
  steps: { voicedMidi: number[] }[], motionOptions: HarmonicMotionOptions,
}) {
  const score = call('compileComposition', { plan: passage.plan });
  assert.equal(passage.linePlans.length, passage.lines.lines.length);
  assert.equal(new Set(passage.lines.lines.map(line => line.id)).size, passage.lines.lines.length);
  const ownership = new Set<string>();
  const heard: string[] = [];
  for (const [index, line] of passage.lines.lines.entries()) {
    const solo = call('compileComposition', { plan: passage.linePlans[index] });
    assert.equal(solo.duration / solo.ppq, score.duration / score.ppq,
      'Auditioning a line preserves its leading and trailing context, including silence.');
    assert.equal(solo.notes.length, line.points.length);
    const expectedNotes: Score['notes'] = [];
    for (const point of line.points) {
      const key = `${point.stepIndex}:${point.memberIndex}`;
      assert.ok(!ownership.has(key), `The exact member ${key} was claimed by two proposed lines.`);
      ownership.add(key);
      assert.equal(point.pitchMillicents, passage.steps[point.stepIndex].voicedMidi[point.memberIndex] * SEMITONE);
      const span = passage.motionOptions.history[point.stepIndex].duration;
      assert.deepEqual(point.duration, span);
      const onset = passage.motionOptions.history.slice(0, point.stepIndex)
        .reduce((sum, step) => sum + step.duration.numerator / step.duration.denominator, 0);
      assert.ok(Math.abs(point.onsetQuarters - onset) < 1e-10,
        'The contour uses harmonic-slot time; the solo compiler retains performed arpeggiation offsets.');
      const start = Math.round(onset * score.ppq);
      const end = start + span.numerator * score.ppq / span.denominator;
      const corresponding = score.notes.filter(note => note.onset >= start && note.onset < end
        && note.pitch.millicents === point.pitchMillicents);
      assert.equal(corresponding.length, 1, 'This fixture has one sounding member at the indexed pitch in each slot.');
      expectedNotes.push(corresponding[0]);
    }
    assert.deepEqual(line.stepsMillicents, line.points.slice(1).map((point, i) =>
      point.pitchMillicents - line.points[i].pitchMillicents),
    'Contour steps use actual registered endpoints, without substituting periodic representatives.');
    for (let pointIndex = 1; pointIndex < line.points.length; pointIndex++) {
      const before = line.points[pointIndex - 1], after = line.points[pointIndex];
      assert.equal(after.stepIndex, before.stepIndex + 1);
      const boundary = passage.lines.boundaries.find(item => item.fromStepIndex === before.stepIndex
        && item.toStepIndex === after.stepIndex);
      assert.ok(boundary?.links.some(link => link.fromMember === before.memberIndex
        && link.toMember === after.memberIndex && link.fromMillicents === before.pitchMillicents
        && link.toMillicents === after.pitchMillicents),
      'A displayed line must compose the same admitted indexed links used by its boundary analysis.');
    }
    assert.deepEqual(routedEvents(solo), routedEvents({ ...score, notes: expectedNotes }));
    heard.push(...routedEvents(solo));
    const scene = call('sceneFromComposition', { plan: passage.linePlans[index] });
    assert.deepEqual(call('decodeScene', { scene: JSON.parse(JSON.stringify(scene)) }), solo);
  }
  const expected = passage.steps.flatMap((step, stepIndex) => step.voicedMidi.map((_, memberIndex) => `${stepIndex}:${memberIndex}`));
  assert.deepEqual([...ownership].sort(), expected.sort());
  assert.deepEqual(heard.sort(), routedEvents(score),
    'The union of executable solo lines is exactly the full passage, including routing, attacks, gates and performance.');
}

test('disabling phrase-continuity preference keeps explicit lines and executable solo ownership', () => {
  const result = call('generateProgression', { options: options({ length: 4, lineContinuity: 0 }),
    chordIds: ['scale-0-3', 'scale-1-3', 'scale-4-3', 'scale-0-3'] });
  assert.equal(result.options.lineContinuity, 0);
  assert.equal(result.lines.continuityWeight, 0);
  assert.equal(result.lines.continuityCost, 0);
  assertLinePartition(result);
});

// Independent exhaustive assignment, deliberately tiny. The integer endpoint
// pitches remain untouched; only this test's distance function projects them.
function assignmentCosts(from: number[], to: number[], period: number | null) {
  assert.equal(from.length, to.length);
  const costs: { total: number, maximum: number }[] = [];
  function visit(index: number, used: Set<number>, lengths: number[]) {
    if (index === from.length) {
      costs.push({ total: lengths.reduce((sum, value) => sum + value, 0), maximum: Math.max(0, ...lengths) });
      return;
    }
    to.forEach((target, member) => {
      if (used.has(member)) return;
      const absolute = Math.abs(target - from[index]);
      const remainder = period === null ? absolute : absolute % period;
      const distance = period === null ? absolute : Math.min(remainder, period - remainder);
      visit(index + 1, new Set([...used, member]), [...lengths, distance]);
    });
  }
  visit(0, new Set(), []);
  return costs.sort((a, b) => a.total - b.total || a.maximum - b.maximum)[0];
}

test('the four-bar chromatic loop has small wrapped movement without inventing an inversion on repeat', () => {
  const chords = [chord('Am', [57, 60, 64]), chord('Abm', [56, 59, 63]),
    chord('G', [55, 59, 62]), chord('Gbm', [54, 58, 61])];
  const saved = structuredClone(chords);
  const totals = [3, 2, 3, 4], maxima = [1, 1, 1, 2], squares = [3, 2, 3, 6];
  for (let index = 0; index < chords.length; index++) {
    const from = chords[index], to = chords[(index + 1) % chords.length];
    const result = call('analyzeHarmonicConnection', { options: connection({
      chords, fromChordId: from.id, toChordId: to.id, geometry: 'periodic', maxIntermediates: 0,
    }) });
    const metrics = result.direct.transitions[0].metrics;
    const periodic = metrics.periodic!;
    const independentlyMatched = assignmentCosts(from.pitchesMillicents, to.pitchesMillicents, OCTAVE);
    assert.equal(periodic.totalMotionMillicents, totals[index] * SEMITONE);
    assert.equal(periodic.totalMotionMillicents, independentlyMatched.total);
    assert.equal(periodic.maxMotionMillicents, maxima[index] * SEMITONE);
    assert.equal(periodic.squaredMotion100CentUnits, squares[index]);
    assert.deepEqual(result.direct.schedule.map(step => step.duration),
      [{ numerator: 4, denominator: 1 }, { numerator: 4, denominator: 1 }],
      'Each supplied chord occupies a complete bar; geometry does not assign offbeat status.');
    assert.deepEqual(sorted(periodic.representative.links.map(link => link.toMillicents)), sorted(to.pitchesMillicents));
    for (const link of periodic.representative.links) {
      assert.equal(link.toMillicents - link.fromMillicents, link.registeredDisplacementMillicents);
      assert.equal(link.registeredDisplacementMillicents,
        link.displacementMillicents + link.winding! * OCTAVE);
    }
    if (index === 3) {
      assert.deepEqual(sorted(periodic.representative.links.map(link => link.displacementMillicents / SEMITONE)), [-2, -1, -1]);
      assert.equal(metrics.registered.totalMotionMillicents, 8 * SEMITONE);
      assert.equal(metrics.registered.maxMotionMillicents, 3 * SEMITONE);
      assert.deepEqual(to.pitchesMillicents, [57, 60, 64].map(pitch => pitch * SEMITONE),
        'The returning chord remains the original Am, including its A bass.');
    }
  }
  assert.deepEqual(chords, saved);
});

test('registered motion, new chromatic members and diminished interval content remain separate metrics', () => {
  const input = connection({ chords: [chord('Dm', [38, 57, 65, 74]), chord('Edim7', [40, 58, 67, 73])],
    fromChordId: 'Dm', toChordId: 'Edim7', maxIntermediates: 0,
    context: { tonicMillicents: 60 * SEMITONE,
      collectionMillicents: [0, 2, 4, 5, 7, 9, 11].map(pitch => pitch * SEMITONE) },
  });
  const result = call('analyzeHarmonicConnection', { options: input });
  const metrics = result.direct.transitions[0].metrics;
  assert.equal(metrics.registered.totalMotionMillicents, 6 * SEMITONE);
  assert.equal(metrics.registered.maxMotionMillicents, 2 * SEMITONE);
  assert.deepEqual(metrics.registered.representative.links.map(link => link.displacementMillicents / SEMITONE), [2, 1, 2, -1]);
  assert.deepEqual(metrics.sourceOutsideClasses, []);
  assert.deepEqual(metrics.newOutsideClasses, [1, 10].map(pitch => pitch * SEMITONE));
  assert.equal(metrics.destinationStrain!.tritonePairs, 2);
  assert.equal(metrics.destinationStrain!.minorSecondPairs, 0);
  assert.equal(result.direct.exposures[1].outsideClassQuarters, 8,
    'Two out-of-collection classes held for four quarters have eight class-quarters of exposure.');
  assert.equal(result.direct.exposures[1].strainPairQuarters, 8);
});

test('periodic equivalence retains exact endpoints, indexed ambiguity and an independent register cost', () => {
  const input = connection({ chords: [chord('from', [60]), chord('to', [72])], maxIntermediates: 0 });
  const result = call('analyzeHarmonicConnection', { options: input });
  const metrics = result.direct.transitions[0].metrics;
  assert.equal(metrics.registered.totalMotionMillicents, OCTAVE);
  assert.equal(metrics.periodic!.totalMotionMillicents, 0);
  assert.equal(metrics.periodic!.commonToneCount, 1);
  assert.equal(metrics.periodic!.heldToneCount, 0);
  assert.equal(metrics.periodic!.representative.links[0].toMillicents, 72 * SEMITONE);
  const duplicate = call('analyzeHarmonicConnection', { options: connection({
    chords: [chord('from', [60, 60]), chord('to', [60, 60])], maxIntermediates: 0,
  }) }).direct.transitions[0].metrics;
  assert.equal(duplicate.periodic!.optimalCorrespondenceCount, 2);
  assert.equal(duplicate.registered.optimalCorrespondenceCount, 2);
  const half = call('analyzeHarmonicConnection', { options: connection({
    chords: [chord('from', [60]), chord('to', [66])], maxIntermediates: 0,
  }) }).direct.transitions[0].metrics.periodic!;
  assert.equal(half.optimalCorrespondenceCount, 1);
  assert.equal(half.representative.links[0].halfPeriodTie, true,
    'Two shortest directions at half a period are distinct from two member assignments.');
  const reshuffled = call('analyzeHarmonicConnection', { options: connection({
    chords: [chord('from', [60, 64, 67]), chord('to', [79, 64, 60])], maxIntermediates: 0,
  }) }).direct.transitions[0].metrics;
  assert.equal(reshuffled.periodic!.totalMotionMillicents, 0);
  assert.ok(reshuffled.registered.totalMotionMillicents > 0);
  assert.ok(reshuffled.periodic!.representative.links.some(link => link.toMember === 0
    && link.toMillicents === 79 * SEMITONE && link.registeredDisplacementMillicents === OCTAVE));
});

test('arbitrary periods and absent collection evidence do not manufacture Western strain or scale membership', () => {
  const period = 1900000;
  const from = chord('from', [60]);
  const to = { ...chord('to', [60]), pitchesMillicents: [from.pitchesMillicents[0] + period] };
  const result = call('analyzeHarmonicConnection', { options: connection({
    chords: [from, to], periodMillicents: period, geometry: 'periodic', maxIntermediates: 0,
  }) });
  const metrics = result.direct.transitions[0].metrics;
  assert.equal(metrics.periodic!.totalMotionMillicents, 0);
  assert.equal(metrics.registered.totalMotionMillicents, period);
  assert.equal(metrics.sourceStrain, null);
  assert.equal(metrics.destinationStrain, null);
  assert.equal(metrics.newOutsideClasses, null);
  assert.equal(result.direct.exposures[0].outsideClassQuarters, null);
  const aperiodic = call('analyzeHarmonicConnection', { options: connection({
    chords: [from, to], periodMillicents: null, geometry: 'registered', maxIntermediates: 0,
  }) }).direct.transitions[0].metrics;
  assert.equal(aperiodic.periodic, null);
  assert.equal(aperiodic.registered.totalMotionMillicents, period);
});

test('changing chord cardinality charges unmatched members instead of inventing zero-cost voice continuity', () => {
  const result = call('analyzeHarmonicConnection', { options: connection({
    chords: [chord('from', [60, 64]), chord('to', [60])], maxIntermediates: 0,
  }) });
  const metrics = result.direct.transitions[0].metrics;
  assert.equal(metrics.registered.totalMotionMillicents, 0);
  assert.equal(metrics.registered.unmatchedCount, 1);
  assert.deepEqual(metrics.registered.representative.departures, [1]);
  assert.deepEqual(metrics.registered.representative.arrivals, []);
  assert.equal(metrics.periodic!.unmatchedCount, 1);
  assert.equal(result.direct.cost.addedMembers, 1);
  assert.equal(result.direct.cost.total, 1);
});

test('bounded route minima and tie counts agree with independently enumerating every permitted path', () => {
  const input = connection();
  const result = call('analyzeHarmonicConnection', { options: input });
  assert.equal(result.routes.length, 4);
  for (let insertions = 0; insertions <= 3; insertions++) {
    const candidates: { cost: number, ids: string[] }[] = [];
    function enumerate(ids: string[]) {
      if (ids.length < insertions) {
        for (const state of input.chords) enumerate([...ids, state.id]);
        return;
      }
      const path = [input.fromChordId, ...ids, input.toChordId];
      let cost = insertions;
      for (let index = 1; index < path.length; index++) {
        const before = input.chords.find(chord => chord.id === path[index - 1])!.pitchesMillicents[0];
        const after = input.chords.find(chord => chord.id === path[index])!.pitchesMillicents[0];
        cost += ((after - before) / SEMITONE) ** 2;
      }
      candidates.push({ cost, ids: path });
    }
    enumerate([]);
    const minimum = Math.min(...candidates.map(candidate => candidate.cost));
    const optimal = candidates.filter(candidate => candidate.cost === minimum);
    const route = result.routes[insertions];
    assert.equal(route.cost.total, minimum);
    assert.equal(route.optimalRouteCount, optimal.length);
    assert.ok(optimal.some(candidate => JSON.stringify(candidate.ids) === JSON.stringify(route.chordIds)));
    assert.equal(route.intermediateCount, insertions);
    assert.equal(route.chordIds[0], input.fromChordId);
    assert.equal(route.chordIds.at(-1), input.toChordId);
    assert.ok(route.totalMotionMillicents >= result.direct.totalMotionMillicents,
      'Intermediate states cannot beat the direct equal-cardinality L1 distance.');
    assert.equal(route.cost.total, route.transitions.reduce((sum, transition) => sum + transition.edgeCost.total, 0)
      + route.exposures.reduce((sum, exposure) => sum + exposure.collectionCost + exposure.sonorityCost, 0)
      + input.weights.insertion * insertions);
  }
  assert.equal(result.bestRouteIndex, 1);
  assert.deepEqual(result.routes[1].chordIds, ['from', 'middle', 'to']);
  assert.equal(result.routes[1].maxMotionMillicents, 4 * SEMITONE);
  assert.equal(result.direct.maxMotionMillicents, 8 * SEMITONE);
  assert.equal(result.routes[1].cost.motionSquared, 32);
  assert.equal(result.direct.cost.motionSquared, 64);
  assert.equal(result.routes[1].costChangeFromDirect, -31);
});

test('positive insertion cost prevents free loops and explicit intermediate inventories bound the search', () => {
  const input = connection({ chords: [chord('from', [60]), chord('to', [60]), chord('foreign', [61])] });
  for (const key of Object.keys(input.weights) as (keyof typeof input.weights)[]) input.weights[key] = 0;
  input.weights.insertion = 1;
  const result = call('analyzeHarmonicConnection', { options: input });
  assert.equal(result.bestRouteIndex, 0);
  assert.deepEqual(result.routes.map(route => route.cost.total), [0, 1, 2, 3]);
  assert.deepEqual(result.routes.map(route => route.optimalRouteCount), [1, 3, 9, 27]);
  const directOnly = call('analyzeHarmonicConnection', { options: { ...input, intermediateChordIds: [] } });
  assert.equal(directOnly.routes.length, 1);
  assert.equal(directOnly.intermediateStateCount, 0);
  const restricted = call('analyzeHarmonicConnection', { options: { ...input, intermediateChordIds: ['foreign'] } });
  assert.ok(restricted.routes.every(route => route.chordIds.slice(1, -1).every(id => id === 'foreign')));
  assert.ok(restricted.routes.every(route => route.optimalRouteCount === 1));
});

test('zero collection penalty admits smooth foreign triads while duration exposure remains visible', () => {
  const input = connection({ chords: [chord('from', [57, 60, 64]), chord('foreign', [56, 59, 63]), chord('to', [55, 59, 62])],
    context: { tonicMillicents: 57 * SEMITONE, collectionMillicents: [0, 2, 4, 5, 7, 9, 11].map(pitch => pitch * SEMITONE) },
    geometry: 'periodic', intermediateChordIds: ['foreign'], maxIntermediates: 1,
  });
  input.weights.insertion = 0.1;
  const result = call('analyzeHarmonicConnection', { options: input });
  assert.equal(result.routes[1].chordIds[1], 'foreign');
  assert.equal(result.routes[1].exposures[1].outsideClassQuarters, 4);
  assert.equal(result.routes[1].exposures[1].collectionCost, 0);
  assert.ok(result.routes[1].cost.total < result.direct.cost.total,
    'Scale membership must be a disclosed preference, not a hidden ban on a smooth chromatic bridge.');
  const weighted = structuredClone(input); weighted.weights.collectionExposure = 1;
  const withExposure = call('analyzeHarmonicConnection', { options: weighted });
  assert.equal(withExposure.routes[1].cost.collectionExposure, 4);
  assert.equal(withExposure.routes[1].cost.total - result.routes[1].cost.total, 4);
  assert.equal(withExposure.routes[1].exposures.reduce((sum, exposure) => sum + exposure.quarters, 0), 8);
});

test('connecting routes preserve authored anchors and subdivide only their source bar through the sole compiler', () => {
  for (const arpeggiate of [false, true]) {
    const original = call('generateProgression', { options: options({ color: 'adventurous', arpeggiate, length: 4 }),
      chordIds: ['scale-0-3', 'dominant-4', 'scale-4-3', 'scale-0-3'] });
    assertLinePartition(original);
    const input = { options: original.options, chordIds: original.steps.map(step => step.chordId),
      fromIndex: 1, maxIntermediates: 3 };
    const saved = structuredClone(input);
    const connected = call('connectProgression', input);
    assert.deepEqual(input, saved);
    assert.deepEqual(connected.anchorChordIds, input.chordIds);
    assert.equal(connected.fromIndex, input.fromIndex);
    assert.deepEqual(connected.previews.map(preview => preview.intermediateCount), [0, 1, 2, 3]);
    for (const preview of connected.previews) {
      assert.equal(preview.steps.length, original.steps.length + preview.intermediateCount);
      assert.equal(preview.steps.filter(step => step.anchorIndex === null).length, preview.intermediateCount);
      const anchors = preview.steps.filter(step => step.anchorIndex !== null);
      assert.deepEqual(anchors.map(step => step.chord.id), input.chordIds,
        'Connecting surface events must retain the authored D7→G target at the anchor layer.');
      assert.deepEqual(anchors.map(step => step.voicedMidi), original.steps.map(step => step.voicedMidi),
        'A cheaper projected correspondence must never rewrite an endpoint voicing.');
      const endpointCounts = [original.steps[input.fromIndex].voicedMidi.length,
        original.steps[input.fromIndex + 1].voicedMidi.length];
      assert.ok(preview.steps.filter(step => step.anchorIndex === null).every(step =>
        step.voicedMidi.length >= Math.min(...endpointCounts) && step.voicedMidi.length <= Math.max(...endpointCounts)),
      'The progression adapter cannot manufacture smoother movement by dropping and later restoring voices.');
      const score = call('compileComposition', { plan: preview.plan });
      assert.equal(score.duration / score.ppq, 16);
      assert.equal(score.notes.length, preview.steps.reduce((sum, step) => sum + step.voicedMidi.length, 0));
      assert.equal(new Set(score.notes.map(note => note.id)).size, score.notes.length);
      let tick = 0;
      for (const step of preview.steps) {
        const duration = step.duration.numerator / step.duration.denominator;
        const durationTicks = step.duration.numerator * score.ppq / step.duration.denominator;
        assert.ok(Number.isInteger(durationTicks), 'The compiler must exactly represent every rational subdivision.');
        if (step.anchorIndex !== null) {
          assert.equal(tick, step.anchorIndex * 4 * score.ppq, 'Every original anchor retains its exact bar onset.');
          assert.equal(duration, step.anchorIndex === input.fromIndex ? 4 / (preview.intermediateCount + 1) : 4);
        } else {
          assert.equal(duration, 4 / (preview.intermediateCount + 1));
        }
        const end = tick + durationTicks;
        const notes = score.notes.filter(note => note.onset >= tick && note.onset < end);
        assert.deepEqual(sorted(notes.map(note => note.pitch.millicents)),
          sorted(step.voicedMidi.map(pitch => pitch * SEMITONE)));
        assert.equal(new Set(notes.map(note => note.onset)).size, arpeggiate ? step.voicedMidi.length : 1);
        tick = end;
      }
      assert.equal(tick, 16 * score.ppq);
      const scene = call('sceneFromComposition', { plan: preview.plan });
      assert.equal(scene.origin, 'authored');
      assert.deepEqual(call('decodeScene', { scene: JSON.parse(JSON.stringify(scene)) }), score);
      const imported = call('importMidi', { bytes: call('exportScoreMidi', { score }) }).score;
      assert.deepEqual(events(imported), events(score));
      if (preview.intermediateCount === 3) assertLinePartition(preview);
    }
  }
});

test('connecting-route requests reject invalid bounds, unknown anchors and contradictory directed targets', () => {
  const result = call('generateProgression', { options: options({ length: 4, color: 'adventurous' }) });
  const input = { options: result.options, chordIds: result.steps.map(step => step.chordId), fromIndex: 1 };
  for (const fromIndex of [-1, 1.5, result.steps.length - 1, result.steps.length]) {
    assert.throws(() => call('connectProgression', { ...input, fromIndex }), /invalid|index|range|edge|transition/i);
  }
  for (const maxIntermediates of [-1, 0.5, 4]) {
    assert.throws(() => call('connectProgression', { ...input, maxIntermediates }), /invalid|range|intermediate|maximum|bound/i);
  }
  assert.throws(() => call('connectProgression', { ...input, chordIds: ['missing'] }), /invalid|length|unknown|chord/i);
  assert.throws(() => call('connectProgression', { ...input,
    chordIds: ['scale-0-3', 'dominant-4', 'scale-3-3', 'scale-0-3'] }), /directed|target|follow/i,
    'Surface connection search cannot erase an already contradictory authored target.');
});

test('connection search rejects invalid metric premises and nonpositive insertion penalties', () => {
  for (const insertion of [0, -1]) {
    const input = connection();
    input.weights.insertion = insertion;
    assert.throws(() => call('analyzeHarmonicConnection', { options: input }), /positive|insertion|weight|invalid/i);
  }
  for (const patch of [
    { fromChordId: 'missing' }, { toChordId: 'missing' }, { intermediateChordIds: ['missing'] },
    { sourceDuration: { numerator: 0, denominator: 1 } },
    { destinationDuration: { numerator: 1, denominator: 0 } },
    { periodMillicents: 0 }, { periodMillicents: null, geometry: 'periodic' as const },
    { maxIntermediates: -1 },
  ]) {
    assert.throws(() => call('analyzeHarmonicConnection', { options: connection(patch) }),
      /invalid|unknown|period|duration|positive|missing|chord|integer|range/i);
  }
  const negative = connection(); negative.weights.motionSquared = -1;
  assert.throws(() => call('analyzeHarmonicConnection', { options: negative }), /invalid|negative|weight|nonnegative/i);
});
