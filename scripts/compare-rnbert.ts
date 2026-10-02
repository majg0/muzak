import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { importMidi, exportScoreMidi } from '../src/score/midi-score';
import { compactHarmonyMetrics, evaluateHarmony, loadDevelopment,
  type HarmonicReference, type HarmonyPrediction, type HarmonyWork } from './evaluate-harmony';
import type { Score } from '../src/score/score';
import type { HarmonyWindow } from '../src/core/generated/HarmonyWindow';
import type { HarmonyFunctionalRoot } from '../src/core/generated/HarmonyFunctionalRoot';
import type { HarmonyContextOptions } from '../src/core/generated/HarmonyContextOptions';

const hash = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const pc = (pitch: number) => ((pitch % 1_200_000) + 1_200_000) % 1_200_000;
const equal = (a: number[], b: number[]) => a.length === b.length && a.every((v, i) => v === b[i]);
const sourceId = 'batik-mozart-harmony-9c5f700';
type Work = HarmonyWork & { derivedScoreMidi: { path: string; sha256: string }; derivedScore: { path: string; sha256: string } };
type MappedPrediction = { windows: Array<HarmonyPrediction['windows'][number] & { tonicPitchClass?: number | null }> };
type ContextReply = { parameters: HarmonyContextOptions; tonicFilter: boolean; proposedCount: number;
  tonicRejectedCount: number; proposals: Array<{ windowIndex: number; functionalRoot: HarmonyFunctionalRoot }> };

/** Native Rust owns the rule and the predicted-tonic gate. This only adapts
 * model observations into its DTO; zero fit fields are explicitly uncomputed. */
function refineContext(executable: string, score: Score, prediction: MappedPrediction, options?: Partial<HarmonyContextOptions>) {
  const tonics = prediction.windows.map(w => {
    if (w.tonicPitchClass === undefined) throw Error('Context refinement requires mapper tonicPitchClass metadata for every window.');
    return w.tonicPitchClass;
  });
  const windows: HarmonyWindow[] = prediction.windows.map((w, index) => ({
    id: `model-${index}`, startTick: w.startTick, endTick: w.endTick, label: 'model realization', rest: false,
    noteIds: [], coreNoteIds: [], colorNoteIds: [], residualNoteIds: [], unsupportedNoteIds: [], percussionNoteIds: [],
    alternatives: w.alternatives.map(h => ({ ...h, templateId: 'model', label: 'model realization',
      score: 0, coreCoverage: 0, coreMassFraction: 0, contextualCost: null })),
    selected: w.selected, ambiguityGap: null, localAmbiguityGap: null, roles: [], rhythms: [],
  }));
  const input = JSON.stringify({ score, windows, predictedTonicPitchClasses: tonics, options });
  const result = spawnSync(resolve(executable), [], { input, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw Error(`Native context adapter failed (${result.status}): ${result.stderr}`);
  const reply: ContextReply = JSON.parse(result.stdout);
  if (!reply.tonicFilter || reply.parameters.requireFullCore !== false) throw Error('Unexpected context adapter configuration.');
  const refined = structuredClone(prediction), seen = new Set<number>();
  for (const p of reply.proposals) {
    if (!Number.isSafeInteger(p.windowIndex) || seen.has(p.windowIndex)) throw Error('Invalid or duplicated context proposal.');
    seen.add(p.windowIndex);
    const w = refined.windows[p.windowIndex];
    if (!w || w.selected !== p.functionalRoot.realizationAlternativeIndex) throw Error('Context cannot select an unpredicted model alternative.');
    w.functionalRoot = p.functionalRoot;
  }
  return { refined, evidence: { ...reply, inputSha256: hash(input) } };
}

/** Posthoc diagnostics only: labels never feed prediction or choose a model setting. */
export function diagnosePredictionErrors(prediction: HarmonyPrediction, references: HarmonicReference[], ppq: number) {
  const actual = references.filter(r => !r.issue && r.root !== null);
  const partition = { correct: 0, sameCoreWrongRoot: 0, rightRootWrongCore: 0, bothWrong: 0, unselectedOrUncovered: 0 };
  const geometry = { wrongInSingleLabelWindows: 0, wrongInMixedLabelWindows: 0,
    coveredReferenceTicks: 0, oracleCorrectTicks: 0, mixedLabelWindows: 0 };
  const referenceTicks = actual.reduce((n, r) => n + r.endTick - r.startTick, 0);
  let selectedTicks = 0;
  for (const window of prediction.windows) {
    const overlaps = actual.flatMap(r => {
      const ticks = Math.max(0, Math.min(r.endTick, window.endTick) - Math.max(r.startTick, window.startTick));
      return ticks ? [{ r, ticks }] : [];
    });
    const masses = new Map<string, number>();
    for (const { r, ticks } of overlaps) {
      const key = JSON.stringify([r.root, r.core]); masses.set(key, (masses.get(key) ?? 0) + ticks);
      geometry.coveredReferenceTicks += ticks;
    }
    geometry.oracleCorrectTicks += Math.max(0, ...masses.values());
    const mixed = masses.size > 1; if (mixed) geometry.mixedLabelWindows++;
    const selected = window.selected === null ? undefined : window.alternatives[window.selected];
    if (!selected) continue;
    const root = pc(window.functionalRoot?.realizationAlternativeIndex === window.selected
      ? window.functionalRoot.rootMillicents : selected.rootMillicents);
    const core = [...new Set(selected.coreIntervals.map(p => pc(selected.rootMillicents + p)))].sort((a, b) => a - b);
    for (const { r, ticks } of overlaps) {
      selectedTicks += ticks;
      const sameRoot = root === r.root, sameCore = equal(core, r.core);
      partition[sameRoot && sameCore ? 'correct' : sameCore ? 'sameCoreWrongRoot' : sameRoot ? 'rightRootWrongCore' : 'bothWrong'] += ticks;
      if (!sameRoot || !sameCore) geometry[mixed ? 'wrongInMixedLabelWindows' : 'wrongInSingleLabelWindows'] += ticks;
    }
  }
  partition.unselectedOrUncovered = referenceTicks - selectedTicks;
  const coarseBoundaryLoss = geometry.coveredReferenceTicks - geometry.oracleCorrectTicks;
  return { units: 'quarter notes', errorPartition: Object.fromEntries(Object.entries(partition).map(([k, v]) => [k, v / ppq])),
    fixedWindowOracle: { description: 'Posthoc best reference root/core label per existing model window, unconstrained vocabulary. Not a model result; no inference rerun.',
      accuracyCeiling: geometry.oracleCorrectTicks / referenceTicks,
      unavoidableWithinWindowConflictQuarters: coarseBoundaryLoss / ppq,
      absentWindowCoverageQuarters: (referenceTicks - geometry.coveredReferenceTicks) / ppq,
      selectedLabelGapToOracleQuarters: (geometry.oracleCorrectTicks - partition.correct) / ppq,
      mixedLabelWindows: geometry.mixedLabelWindows },
    observedErrorLocation: { description: 'Mixed windows straddle reference label changes; their errors are not all attributable to timing.',
      singleReferenceLabelWindowQuarters: geometry.wrongInSingleLabelWindows / ppq,
      mixedReferenceLabelWindowQuarters: geometry.wrongInMixedLabelWindows / ppq } };
}

function run(args: string[]) {
  const optionsAt = args.findIndex(a => a === '--context-options' || a.startsWith('--context-options='));
  let contextOptions: Partial<HarmonyContextOptions> | undefined;
  if (optionsAt >= 0) {
    const inline = args[optionsAt].startsWith('--context-options=');
    const path = inline ? args[optionsAt].slice('--context-options='.length) : args[optionsAt + 1];
    if (!path || path.startsWith('--')) throw Error('Missing context options JSON path.');
    contextOptions = JSON.parse(readFileSync(path, 'utf8'));
    args = [...args.slice(0, optionsAt), ...args.slice(optionsAt + (inline ? 1 : 2))];
  }
  const contextAt = args.findIndex(a => a === '--context' || a.startsWith('--context='));
  let context: string | undefined;
  if (contextAt >= 0) {
    const inline = args[contextAt].startsWith('--context=');
    context = inline ? args[contextAt].slice('--context='.length) : args[contextAt + 1];
    if (!context || context.startsWith('--')) throw Error('Missing native context example path.');
    args = [...args.slice(0, contextAt), ...args.slice(contextAt + (inline ? 1 : 2))];
  }
  const profileAt = args.indexOf('--profile');
  const profile = profileAt < 0 ? 'baseline' : args[profileAt + 1];
  if (!profile || !/^[a-z0-9][a-z0-9._-]*$/.test(profile)) throw Error('Invalid output profile.');
  if (profileAt >= 0) args = [...args.slice(0, profileAt), ...args.slice(profileAt + 2)];
  const prepare = args.includes('--prepare');
  if (args.some(a => !['--prepare', '--evaluate'].includes(a)) || args.length !== 1 || (prepare && context) || (contextOptions && !context)) {
    throw Error('Usage: npx tsx scripts/compare-rnbert.ts --prepare|--evaluate [--profile name] [--context native-example-path [--context-options JSON]] (development only).');
  }
  const root = '.audit/contextual/rnbert'; mkdirSync(root, { recursive: true });
  const sources = JSON.parse(readFileSync('scripts/research/rnbert-sources.json', 'utf8'));
  const registry = JSON.parse(readFileSync('docs/research/corpus-candidates.json', 'utf8'));
  const corpus = registry.evaluationSources.find((s: { id: string }) => s.id === sourceId);
  const works: Work[] = sources.developmentWorks.map((id: string) => {
    const work = corpus?.works.find((w: Work) => w.id === id);
    if (!work || work.split !== 'development') throw Error(`Development-only admission failed: ${id}`);
    return work;
  });
  if (prepare) {
    const results = works.map(work => {
      const bytes = readFileSync(work.derivedScoreMidi.path);
      if (hash(bytes) !== work.derivedScoreMidi.sha256) throw Error('Derived source MIDI hash mismatch.');
      const { score, issues } = importMidi(bytes), notes = score.notes.filter(n => n.duration > 0);
      const projected = exportScoreMidi({ ...score, notes });
      const signature = (n: typeof notes[number]) => JSON.stringify([n.part, n.onset, n.duration, n.pitch.millicents, n.velocity]);
      if (JSON.stringify(importMidi(projected).score.notes.map(signature).sort()) !== JSON.stringify(notes.map(signature).sort())) {
        throw Error('Positive-duration MIDI projection changed an event.');
      }
      const path = `${root}/${work.id}.positive.mid`, expectedPath = `${root}/${work.id}.expected-notes.json`;
      writeFileSync(path, projected);
      const expected = notes.map(n => ({ pitch: n.pitch.millicents / 100_000, onset: n.onset / score.ppq,
        release: (n.onset + n.duration) / score.ppq, track: score.parts.find(p => p.id === n.part)!.track }));
      const expectedBytes = JSON.stringify(expected) + '\n'; writeFileSync(expectedPath, expectedBytes);
      return { work: work.id, split: work.split, source: work.derivedScoreMidi.path, sourceSha256: hash(bytes), projection: path,
        sha256: hash(projected), expectedPath, expectedSha256: hash(expectedBytes), sourceNotes: score.notes.length,
        positiveNotes: notes.length, excludedZeroDurationNotes: score.notes.length - notes.length,
        exactPositiveRoundtrip: true, issues, ppq: score.ppq, duration: score.duration };
    });
    writeFileSync(`${root}/admission.json`, JSON.stringify({ policy: 'Zero-duration notes excluded explicitly; source positive events unchanged. No labels/keys/boundaries read.', works: results }, null, 2) + '\n');
    console.log(`Prepared ${results.length} development MIDI inputs; no reference labels read.`); return;
  }
  // Complete and hash every optional refinement before opening reference labels.
  const prepared = works.map(work => {
    const path = profile === 'baseline' ? `${root}/${work.id}-predictions.json` : `${root}/${work.id}-${profile}-predictions.json`;
    const bytes = readFileSync(path);
    const prediction: MappedPrediction = JSON.parse(bytes.toString('utf8')), predictionSha256 = hash(bytes);
    if (prediction.windows.some(w => w.functionalRoot)) throw Error('Mapped input already contains contextual refinement; use the raw model profile.');
    if (!context) return { work, path, prediction, predictionSha256 };
    const scoreBytes = readFileSync(work.derivedScore.path);
    if (hash(scoreBytes) !== work.derivedScore.sha256) throw Error('Derived observation Score hash mismatch.');
    const score: Score = JSON.parse(scoreBytes.toString('utf8'));
    const { refined, evidence } = refineContext(context, score, prediction, contextOptions);
    const refinedPath = `${root}/${work.id}-${profile}-context-predictions.json`, refinedBytes = JSON.stringify(refined, null, 2) + '\n';
    writeFileSync(refinedPath, refinedBytes);
    return { work, path, prediction, predictionSha256, refined, refinedPath, refinedSha256: hash(refinedBytes),
      evidence, sourceScore: score, sourceScoreSha256: hash(scoreBytes) };
  });
  const results = prepared.map(item => {
    const { work, prediction, predictionSha256 } = item;
    const { score, references, diagnostics } = loadDevelopment(work);
    if (item.sourceScore && !isDeepStrictEqual(item.sourceScore, score)) throw Error('Context and evaluation observation Scores disagree.');
    const evaluated = item.refined ?? prediction;
    const rawMetrics = compactHarmonyMetrics(evaluateHarmony(prediction, references, score.ppq, score.duration));
    const metrics = item.refined ? compactHarmonyMetrics(evaluateHarmony(evaluated, references, score.ppq, score.duration)) : rawMetrics;
    if (metrics.referenceTicks !== rawMetrics.referenceTicks || metrics.selectedTicks !== rawMetrics.selectedTicks
      || metrics.coreCorrectTicks !== rawMetrics.coreCorrectTicks) throw Error('Context refinement changed source coverage or realized core.');
    return { id: work.id, trainingOverlap: true, predictionPath: item.path, predictionSha256,
      modelWindows: prediction.windows.length, metrics, errors: diagnosePredictionErrors(evaluated, references, score.ppq), diagnostics,
      ...(item.refined ? { rawMetrics, rawErrors: diagnosePredictionErrors(prediction, references, score.ppq),
        refinedPath: item.refinedPath, refinedSha256: item.refinedSha256, sourceScoreSha256: item.sourceScoreSha256, context: item.evidence } : {}) };
  });
  const report = { experiment: 'Official RNBert training-overlap development diagnostic, not generalization.', profile,
    input: 'Projected notation-time MIDI; upstream quantization/detremolo/salami-slicing/dedoubling. No supplied key or chord labels/boundaries.',
    mapping: 'Author atomic RN root translation plus diatonic-default secondary-mode table and CAUTIONARY minor6/7. Explicit predicted quality supplies realized core, independently of functional root.',
    context: context ? { executable: resolve(context), executableSha256: hash(readFileSync(context)),
      adapterSourceSha256: hash(readFileSync('crates/muzak-core/examples/harmony-context.rs')),
      ruleSourceSha256: hash(readFileSync('crates/muzak-core/src/harmony_context.rs')),
      method: 'Rust observed-bass context with explicit returned parameters and optional inferred-resolution dependencies, accepting proposals only when the realized root equals predicted model-key tonic. No key inference or reference inputs. Functional root changes only; realized core, model windows and admission are fixed.',
      adapter: 'Uncomputed role arrays are empty and fit scalars0; these are not scene/evidence claims. requireFullCore=false; no proposal consults uncomputed coverage.',
    } : null,
    sourcesManifest: 'scripts/research/rnbert-sources.json', modelManifest: `${root}/model-manifest.json`,
    runtimeManifest: `${root}/runtime-manifest.json`, inferenceRuntime: `${root}/inference-runtime-${profile}.json`,
    mappingManifest: profile === 'baseline' ? `${root}/mapping-manifest.json` : `${root}/mapping-manifest-${profile}.json`,
    admission: `${root}/parser-admission.json`, evaluationSourceSha256: hash(readFileSync('scripts/evaluate-harmony.ts')), results };
  const output = context ? `${root}/strict-agreement-${profile}-context.json`
    : profile === 'baseline' ? `${root}/strict-agreement.json` : `${root}/strict-agreement-${profile}.json`;
  writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(results.map(r => ({ id: r.id, joint: r.metrics.jointAccuracy, core: r.metrics.coreAccuracy, errors: r.errors })), null, 2));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) run(process.argv.slice(2));
