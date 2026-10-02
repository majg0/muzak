import test from 'node:test';
import assert from 'node:assert/strict';
import type { Score } from '../src/score/score';
import type { HarmonyWindow } from '../src/core/generated/HarmonyWindow';
import { inferFunctionSpans, type FunctionSpanProof, type FunctionSpanEvidence } from '../scripts/research/rnbert-function-span';
import { projectHarmonyLayers } from '../scripts/compare-rnbert';

const hash = 'a'.repeat(64);
function fixture() {
  const score: Score = { ppq: 4, duration: 12, parts: [{ id: 'p', name: '', track: 0, channel: 0, percussion: false }],
    notes: [[55, 60, 64], [55, 60, 64], [55, 59, 62]].flatMap((pitches, j) => pitches.map((p, i) => ({
      id: `n${j}-${i}`, part: 'p', onset: j * 4, duration: 4, pitch: { millicents: p * 100_000 }, velocity: 80, releaseVelocity: 64,
    }))), attachments: [], trackEnds: [12] };
  const windows: HarmonyWindow[] = [0, 0, 700_000].map((root, i) => ({ id: `w${i}`, startTick: i * 4, endTick: i * 4 + 4,
    label: '', rest: false, noteIds: [], coreNoteIds: [], colorNoteIds: [], residualNoteIds: [], unsupportedNoteIds: [], percussionNoteIds: [],
    selected: 0, alternatives: [{ rootMillicents: root, coreIntervals: [0, 400_000, 700_000], colorIntervals: [],
      templateId: 'external', label: '', score: 0, coreCoverage: 0, coreMassFraction: 0, contextualCost: null }],
    ambiguityGap: null, localAmbiguityGap: null, roles: [], rhythms: [] }));
  const prediction = { windows: windows.map(w => ({ ...w, tonicPitchClass: 0 })) };
  const evidence: FunctionSpanEvidence = { path: 'source-decoder.json', sha256: hash, ppq: 4,
    frames: windows.map(w => ({ startTick: w.startTick, endTick: w.endTick, states: [{ root: w.alternatives[0].rootMillicents,
      core: w.alternatives[0].coreIntervals.map(p => (p + w.alternatives[0].rootMillicents) % 1_200_000).sort((a, b) => a - b), inversion: 2 }] })) };
  // Endpoint detection is a trusted native callback; this fixture tests its scope,
  // evidence mapping and admission, not a replacement cadence classifier.
  const proof = (i: number, j: number): FunctionSpanProof => ({ pairWindows: [windows[i], windows[j]],
    nativeProposal: { windowIndex: 0, functionalRoot: { rootMillicents: 700_000, realizationAlternativeIndex: 0,
      evidence: { nextWindowIndex: 1, bassMillicents: 700_000, currentBassTick: 0, nextBassTick: 8,
        currentBassNoteIds: ['n0-0'], nextBassNoteIds: ['n2-0'], resolutionNoteIds: ['n2-1', 'n2-2'], observedResolutionIntervals: [0, 400_000, 700_000], resolutionEndTick: 12 } } },
    parameters: { includeAlternatives: false, requireFullCore: false, bassPosition: 'lowestSounding', allowImpliedResolution: true,
      maxGapTicks: windows[j].startTick - windows[i].endTick, maxEvidenceVisits: 1000, maxProposals: 10 },
    inputSha256: hash, nativeExecutableSha256: hash });
  return { score, prediction, evidence, proof };
}

test('continuation retains local native proof and explicit global indices without mutation', () => {
  const f = fixture(), before = structuredClone(f.prediction);
  const result = inferFunctionSpans(f.score, f.prediction, f.evidence, f.proof);
  assert.equal(result.records.length, 1);
  const r = result.records[0];
  assert.deepEqual(r.endpointProof.localToGlobalWindowIndices, [0, 2]);
  assert.equal(r.endpointProof.nativeProposal.functionalRoot.evidence.nextWindowIndex, 1);
  assert.deepEqual(r.continuationWindows.map(w => w.windowIndex), [1]);
  assert.equal(r.numericHeadWitnesses.uniformInversion, 2);
  assert.deepEqual(f.prediction, before);
  const surface = structuredClone(f.prediction);
  surface.windows[0].alternatives[0].coreIntervals = [0, 300_000, 700_000];
  const projected = projectHarmonyLayers(f.prediction, surface, f.score.duration, result.records);
  assert.equal(projected.cells[0].functionRootMillicents, 700_000);
  assert.deepEqual(projected.cells[0].corePitchClasses, [0, 300_000, 700_000]);
  assert.equal(projected.cells[0].functionRootSource?.kind, 'model-assisted-continuation');
  assert(projected.prediction.windows.every(w => !('functionalRoot' in w)));
  assert.deepEqual(projectHarmonyLayers(f.prediction, surface, 12, []).prediction,
    projectHarmonyLayers(f.prediction, surface, 12).prediction);
  assert.throws(() => projectHarmonyLayers(f.prediction, surface, 12, [{ ...r, endTick: r.endTick + 1 }]), /immutable seed/);
  assert.deepEqual(f.prediction, before);
  r.endpointProof.pairWindows[0].endTick = 3;
  assert.deepEqual(f.prediction, before);
});

test('numeric missingness, conflicting inversion and different selected state abstain', () => {
  for (const edit of [
    (f: ReturnType<typeof fixture>) => { f.evidence.frames[0].states[0].inversion = 0; },
    (f: ReturnType<typeof fixture>) => { f.evidence.frames[0].startTick = 1; },
    (f: ReturnType<typeof fixture>) => { f.evidence.frames[0].states = []; },
    (f: ReturnType<typeof fixture>) => { f.evidence.frames[0].states[0].root = 100_000; },
    (f: ReturnType<typeof fixture>) => { f.evidence.frames[0].states[0].core = [0, 300_000, 700_000]; },
  ]) {
    const f = fixture(); edit(f); let calls = 0;
    assert.equal(inferFunctionSpans(f.score, f.prediction, f.evidence, () => { calls++; return null; }).records.length, 0);
    assert.equal(calls, 0);
  }
});

test('rests, unsupported pitches, bass/key/core changes and gaps are barriers', () => {
  const changes: Array<(f: ReturnType<typeof fixture>) => void> = [
    f => { f.prediction.windows[1].rest = true; }, f => { f.score.notes[3].pitch.millicents -= 200_000; },
    f => { f.score.notes[4].pitch.millicents++; }, f => { f.prediction.windows[1].tonicPitchClass = 700_000; },
    f => { f.prediction.windows[1].alternatives[0].coreIntervals = [0, 300_000, 700_000]; },
    f => { f.prediction.windows[1].alternatives[0].colorIntervals = [200_000]; },
    f => { f.prediction.windows[1].startTick++; }, f => { f.prediction.windows[1].selected = null; },
  ];
  for (const edit of changes) { const f = fixture(); edit(f); assert.equal(inferFunctionSpans(f.score, f.prediction, f.evidence, f.proof).records.length, 0); }
  const f = fixture();
  assert.equal(inferFunctionSpans(f.score, f.prediction, f.evidence, f.proof, { maxContinuationTicks: 3 }).records.length, 0);
  assert.equal(inferFunctionSpans(f.score, f.prediction, f.evidence, () => null).records.length, 0);
});

test('existing proof is preserved and a malformed endpoint proof rejects', () => {
  const f = fixture(); f.prediction.windows[0].functionalRoot = f.proof(0, 2).nativeProposal.functionalRoot;
  const before = structuredClone(f.prediction);
  assert.equal(inferFunctionSpans(f.score, f.prediction, f.evidence, f.proof).records.length, 0);
  assert.deepEqual(f.prediction, before);
  const g = fixture();
  assert.throws(() => inferFunctionSpans(g.score, g.prediction, g.evidence, (i, j) => {
    const p = g.proof(i, j); p.nativeProposal.functionalRoot.evidence.nextWindowIndex = 2; return p;
  }), /Endpoint proof/);
});

test('endpoint source witnesses reject stale ticks, wrong pitches and unrelated notes', () => {
  const corruptions: Array<(p: FunctionSpanProof) => void> = [
    p => { p.nativeProposal.functionalRoot.evidence.currentBassTick = 4; },
    p => { p.nativeProposal.functionalRoot.evidence.nextBassTick = 7; },
    p => { p.nativeProposal.functionalRoot.evidence.currentBassNoteIds = ['n0-1']; },
    p => { p.nativeProposal.functionalRoot.evidence.nextBassNoteIds = ['n1-0']; },
    p => { p.nativeProposal.functionalRoot.evidence.nextBassNoteIds = ['missing']; },
    p => { p.nativeProposal.functionalRoot.evidence.currentBassNoteIds = []; },
    p => { p.nativeProposal.functionalRoot.evidence.bassMillicents = 0; },
    p => { p.nativeProposal.functionalRoot.evidence.resolutionNoteIds = ['n0-1']; },
    p => { p.nativeProposal.functionalRoot.evidence.resolutionEndTick = 8; },
    p => { p.nativeProposal.functionalRoot.evidence.resolutionEndTick = 13; },
  ];
  for (const corrupt of corruptions) {
    const f = fixture();
    assert.throws(() => inferFunctionSpans(f.score, f.prediction, f.evidence, (i, j) => {
      const proof = f.proof(i, j); corrupt(proof); return proof;
    }), /Endpoint proof/);
  }
});

test('exact time scaling, ordering and track repartition retain source hypotheses', () => {
  const f = fixture(); f.score.notes.reverse();
  f.score.parts.push({ id: 'q', name: '', track: 1, channel: 1, percussion: false }); f.score.trackEnds.push(12);
  f.score.notes.forEach((n, i) => { if (i % 2) n.part = 'q'; });
  const a = inferFunctionSpans(f.score, f.prediction, f.evidence, f.proof);
  assert.equal(a.records.length, 1);
  for (const n of f.score.notes) { n.onset *= 3; n.duration *= 3; }
  f.score.ppq *= 3; f.score.duration *= 3; f.score.trackEnds = f.score.trackEnds.map(t => t * 3); f.evidence.ppq *= 3;
  for (const w of f.prediction.windows) { w.startTick *= 3; w.endTick *= 3; }
  for (const w of f.evidence.frames) { w.startTick *= 3; w.endTick *= 3; }
  assert.throws(() => inferFunctionSpans(f.score, f.prediction, f.evidence, (i, j) => {
    const p = f.proof(i, j); p.pairWindows = [f.prediction.windows[i], f.prediction.windows[j]]; return p;
  }), /Endpoint proof bass tick/);
  const b = inferFunctionSpans(f.score, f.prediction, f.evidence, (i, j) => {
    const p = f.proof(i, j); p.pairWindows = [f.prediction.windows[i], f.prediction.windows[j]];
    p.nativeProposal.functionalRoot.evidence.currentBassTick *= 3;
    p.nativeProposal.functionalRoot.evidence.nextBassTick *= 3;
    p.nativeProposal.functionalRoot.evidence.resolutionEndTick *= 3;
    return p;
  });
  assert.equal(b.records.length, 1); assert.equal(b.records[0].endTick, 3 * a.records[0].endTick);
});

test('invalid evidence and resource bounds reject explicitly', () => {
  const f = fixture();
  assert.throws(() => inferFunctionSpans(f.score, f.prediction, { ...f.evidence, ppq: 5 }, f.proof), /timebase/);
  assert.throws(() => inferFunctionSpans(f.score, f.prediction, f.evidence, f.proof, { maxEvidenceVisits: 1 }), /budget/);
  assert.throws(() => inferFunctionSpans(f.score, f.prediction, f.evidence, f.proof, { maxContinuationTicks: NaN }), /bound/);
  f.evidence.frames[0].states.push(f.evidence.frames[0].states[0]);
  assert.throws(() => inferFunctionSpans(f.score, f.prediction, f.evidence, f.proof), /actual selected/);
});
