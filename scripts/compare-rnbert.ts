import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { importMidi, exportScoreMidi } from '../src/score/midi-score';
import { alignReferences, compactHarmonyMetrics, evaluateHarmony, loadDevelopment, parseTable, scoreObservations,
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
type PredictionIdentity = { work: string; ppq: number; sourceScoreSha256: string; targetLabelsRead: false };
type MappingEntry = { work: string; output: string; predictionSha256: string; sourceScoreSha256: string };

/** Source identity and timebase are required before any context or reference read. */
export function admitMappedPrediction(bytes: Uint8Array, entry: MappingEntry, identity: Omit<PredictionIdentity, 'targetLabelsRead'>) {
  const prediction = JSON.parse(Buffer.from(bytes).toString('utf8')) as MappedPrediction & PredictionIdentity;
  if (hash(bytes) !== entry.predictionSha256 || entry.work !== identity.work || prediction.work !== identity.work
    || entry.sourceScoreSha256 !== identity.sourceScoreSha256 || prediction.sourceScoreSha256 !== identity.sourceScoreSha256
    || prediction.ppq !== identity.ppq || prediction.targetLabelsRead !== false || !Array.isArray(prediction.windows)) {
    throw Error('Mapped prediction hash, source identity, timebase or label-free contract differs; regenerate it with the current mapper.');
  }
  return prediction;
}

function mappedProfile(root: string, profile: string, works: Work[]) {
  const path = `${root}/mapping-manifest${profile === 'baseline' ? '' : `-${profile}`}.json`, bytes = readFileSync(path);
  const manifest = JSON.parse(bytes.toString('utf8'));
  if (manifest.profile !== profile || !Array.isArray(manifest.results) || manifest.results.length !== works.length) {
    throw Error('Mapping manifest does not cover the admitted work set exactly.');
  }
  const inputs = new Map<string, { path: string; prediction: MappedPrediction; predictionSha256: string; score: Score; scoreSha256: string }>();
  for (const work of works) {
    const entries = manifest.results.filter((r: MappingEntry) => r.work === work.id);
    const output = `${work.id}${profile === 'baseline' ? '' : `-${profile}`}-predictions.json`;
    if (entries.length !== 1 || entries[0].output !== output) throw Error('Mapping output identity or path differs from its profile.');
    const scoreBytes = checkedAsset(work.derivedScore), score: Score = JSON.parse(scoreBytes.toString('utf8'));
    const sourceScoreSha256 = hash(scoreBytes), predictionPath = `${root}/${output}`, predictionBytes = readFileSync(predictionPath);
    const prediction = admitMappedPrediction(predictionBytes, entries[0], { work: work.id, ppq: score.ppq, sourceScoreSha256 });
    inputs.set(work.id, { path: predictionPath, prediction, predictionSha256: hash(predictionBytes), score, scoreSha256: sourceScoreSha256 });
  }
  return { inputs, manifest: { path, sha256: hash(bytes) } };
}
type ContextReply = { parameters: HarmonyContextOptions; tonicFilter: boolean; proposedCount: number;
  tonicRejectedCount: number; proposals: Array<{ windowIndex: number; functionalRoot: HarmonyFunctionalRoot }>;
  silentGapHold?: { windows: HarmonyWindow[]; extensions: Array<{ windowIndex: number; startTick: number; endTick: number }> } };

function nativeWindows(prediction: HarmonyPrediction): HarmonyWindow[] {
  return prediction.windows.map((w, index) => ({
    id: `model-${index}`, startTick: w.startTick, endTick: w.endTick, label: 'model realization', rest: false,
    noteIds: [], coreNoteIds: [], colorNoteIds: [], residualNoteIds: [], unsupportedNoteIds: [], percussionNoteIds: [],
    alternatives: w.alternatives.map(h => ({ ...h, templateId: 'model', label: 'model realization',
      score: 0, coreCoverage: 0, coreMassFraction: 0, contextualCost: null })),
    selected: w.selected, ambiguityGap: null, localAmbiguityGap: null, roles: [], rhythms: [],
  }));
}

function nativeReply<T>(executable: string, input: string): T {
  const result = spawnSync(resolve(executable), [], { input, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw Error(`Native context adapter failed (${result.status}): ${result.stderr}`);
  return JSON.parse(result.stdout);
}

function applyHeldSpans<T extends HarmonyPrediction>(prediction: T, windows: HarmonyWindow[], held?: ContextReply['silentGapHold']): T {
  const spanBaseline = structuredClone(prediction);
  if (held) {
    if (held.windows.length !== windows.length) throw Error('Silence hold changed the window count.');
    const extensions = new Map(held.extensions.map(e => [e.windowIndex, e]));
    if (extensions.size !== held.extensions.length) throw Error('Duplicate silence-hold extension.');
    held.windows.forEach((w, i) => {
      if (!isDeepStrictEqual({ ...w, endTick: windows[i].endTick }, windows[i])) {
        throw Error('Silence hold changed a field other than the window end.');
      }
      const extension = extensions.get(i);
      if (extension ? extension.startTick !== windows[i].endTick || extension.endTick !== w.endTick
        || w.endTick <= windows[i].endTick : w.endTick !== windows[i].endTick) {
        throw Error('Silence-hold evidence does not match its span change.');
      }
      extensions.delete(i);
      spanBaseline.windows[i].endTick = w.endTick;
    });
    if (extensions.size) throw Error('Silence-hold evidence names an absent window.');
  }
  return spanBaseline;
}

/** Native Rust owns context and silence; model fit fields remain uncomputed. */
export function refineContext(executable: string, score: Score, prediction: MappedPrediction,
  options?: Partial<HarmonyContextOptions>, holdSilentGaps = false) {
  const tonics = prediction.windows.map(w => {
    if (w.tonicPitchClass === undefined) throw Error('Context refinement requires mapper tonicPitchClass metadata for every window.');
    return w.tonicPitchClass;
  });
  const windows = nativeWindows(prediction);
  const input = JSON.stringify({ score, windows, predictedTonicPitchClasses: tonics, options, holdSilentGaps });
  const reply = nativeReply<ContextReply>(executable, input);
  if (!reply.tonicFilter || reply.parameters.requireFullCore !== false) throw Error('Unexpected context adapter configuration.');
  if (holdSilentGaps !== !!reply.silentGapHold) throw Error('Native adapter did not honor the explicit silence policy.');
  const spanBaseline = applyHeldSpans(prediction, windows, reply.silentGapHold);
  const refined = structuredClone(spanBaseline), seen = new Set<number>();
  for (const p of reply.proposals) {
    if (!Number.isSafeInteger(p.windowIndex) || seen.has(p.windowIndex)) throw Error('Invalid or duplicated context proposal.');
    seen.add(p.windowIndex);
    const w = refined.windows[p.windowIndex];
    if (!w || w.selected !== p.functionalRoot.realizationAlternativeIndex) throw Error('Context cannot select an unpredicted model alternative.');
    w.functionalRoot = p.functionalRoot;
  }
  const { silentGapHold, ...contextEvidence } = reply;
  return { refined, spanBaseline, evidence: { ...contextEvidence, inputSha256: hash(input),
    ...(silentGapHold ? { silentGapHold: { extensions: silentGapHold.extensions } } : {}) } };
}

function holdSurface(executable: string, score: Score, prediction: HarmonyPrediction) {
  const windows = nativeWindows(prediction), input = JSON.stringify({ action: 'hold', score, windows });
  const reply = nativeReply<{ silentGapHold: NonNullable<ContextReply['silentGapHold']> }>(executable, input);
  if (Object.keys(reply).length !== 1 || !reply.silentGapHold) throw Error('Expected a hold-only reply without functional claims.');
  return { prediction: applyHeldSpans(prediction, windows, reply.silentGapHold),
    evidence: { inputSha256: hash(input), extensions: reply.silentGapHold.extensions } };
}

/** Metric projection only: original proofs belong to the complete retained layers. */
export function projectHarmonyLayers(functionLayer: HarmonyPrediction, surfaceLayer: HarmonyPrediction, duration: number) {
  type Window = HarmonyPrediction['windows'][number];
  const chosen = (w?: Window) => {
    if (!w || w.selected === null) return null;
    if (!Number.isSafeInteger(w.selected) || w.selected < 0 || !w.alternatives[w.selected]) throw Error('Invalid selected hypothesis.');
    return w.alternatives[w.selected];
  };
  const pitchClass = (value: number) => {
    if (!Number.isSafeInteger(value)) throw Error('Pitch arithmetic must be exact.');
    return pc(value);
  };
  const classes = (h: Window['alternatives'][number], field: 'coreIntervals' | 'colorIntervals') =>
    [...new Set(h[field].map(p => pitchClass(h.rootMillicents + p)))].sort((a, b) => a - b);
  if (!Number.isSafeInteger(duration) || duration < 0) throw Error('Invalid source duration.');
  for (const layer of [functionLayer, surfaceLayer]) {
    let previous = 0;
    for (const w of layer.windows) {
      if (!Number.isSafeInteger(w.startTick) || !Number.isSafeInteger(w.endTick) || w.startTick < previous
        || w.endTick <= w.startTick || w.endTick > duration) throw Error('Invalid layer partition.');
      previous = w.endTick;
      const h = chosen(w);
      if (h) { pitchClass(h.rootMillicents); classes(h, 'coreIntervals'); classes(h, 'colorIntervals'); }
      if (w.functionalRoot && (!h || w.functionalRoot.realizationAlternativeIndex !== w.selected)) throw Error('Stale functional evidence.');
    }
  }
  const cuts = [...new Set([0, duration, ...[functionLayer, surfaceLayer].flatMap(p => p.windows.flatMap(w => [w.startTick, w.endTick]))])].sort((a, b) => a - b);
  const windows: HarmonyPrediction['windows'] = [], cells = [];
  let fi = 0, si = 0;
  for (let i = 0; i + 1 < cuts.length; i++) {
    const startTick = cuts[i], endTick = cuts[i + 1];
    while (fi < functionLayer.windows.length && functionLayer.windows[fi].endTick <= startTick) fi++;
    while (si < surfaceLayer.windows.length && surfaceLayer.windows[si].endTick <= startTick) si++;
    const f = functionLayer.windows[fi], s = surfaceLayer.windows[si];
    const fw = f?.startTick <= startTick && f.endTick >= endTick ? f : undefined;
    const sw = s?.startTick <= startTick && s.endTick >= endTick ? s : undefined;
    const fh = chosen(fw), sh = chosen(sw);
    const functionRootMillicents = fh ? pitchClass(fw!.functionalRoot?.rootMillicents ?? fh.rootMillicents) : null;
    const corePitchClasses = sh ? classes(sh, 'coreIntervals') : [], colorPitchClasses = sh ? classes(sh, 'colorIntervals') : [];
    const available = functionRootMillicents !== null && sh !== null;
    cells.push({ startTick, endTick, functionWindowIndex: fw ? fi : null, surfaceWindowIndex: sw ? si : null,
      functionRootMillicents, corePitchClasses, colorPitchClasses, available });
    windows.push({ startTick, endTick, selected: available ? 0 : null, alternatives: available ? [{ rootMillicents: functionRootMillicents,
      coreIntervals: corePitchClasses.map(p => pitchClass(p - functionRootMillicents)).sort((a, b) => a - b),
      colorIntervals: colorPitchClasses.map(p => pitchClass(p - functionRootMillicents)).sort((a, b) => a - b) }] : [] });
  }
  return { cells, prediction: { windows } };
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

function checkedAsset(asset: { path: string; sha256: string }) {
  const bytes = readFileSync(asset.path);
  if (hash(bytes) !== asset.sha256) throw Error(`Source hash mismatch: ${asset.path}`);
  return bytes;
}

function prepareInput(work: Work, root: string) {
  const bytes = checkedAsset(work.derivedScoreMidi);
  const { score, issues } = importMidi(bytes), notes = score.notes.filter(n => n.duration > 0);
  const projected = exportScoreMidi({ ...score, notes });
  const signature = (n: typeof notes[number]) => JSON.stringify([n.part, n.onset, n.duration, n.pitch.millicents, n.velocity]);
  if (!isDeepStrictEqual(importMidi(projected).score.notes.map(signature).sort(), notes.map(signature).sort())) {
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
}

/** Supervised input preparation has a distinct guard; evaluation stays development-only. */
export function prepareTraining(work: Work, root: string) {
  if (work.split !== 'training') throw Error('Training preparation requires an explicitly assigned training work.');
  const xml = checkedAsset(work.scoreMusicXml).toString('utf8');
  const rows = parseTable(checkedAsset(work.scoreNotes).toString('utf8'));
  const divisions = [...xml.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<divisions>\s*(\d+)\s*<\/divisions>/g)].map(m => Number(m[1]));
  if (!divisions.length || !Number.isSafeInteger(divisions[0]) || divisions[0] <= 0 || divisions.some(n => n !== divisions[0])) {
    throw Error('Training source requires one exact declared division scale.');
  }
  const { score, xmlNotes } = scoreObservations(rows, xml, divisions[0]);
  const midi = exportScoreMidi(score), scoreBytes = JSON.stringify(score, null, 2) + '\n';
  if (hash(midi) !== work.derivedScoreMidi.sha256 || hash(scoreBytes) !== work.derivedScore.sha256) {
    throw Error('Derived training observation disagrees with its admitted registry hash.');
  }
  for (const [path, bytes] of [[work.derivedScore.path, scoreBytes], [work.derivedScoreMidi.path, midi]] as const) {
    mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, bytes);
  }
  const aligned = alignReferences(rows, parseTable(checkedAsset(work.harmonicAnalysis).toString('utf8'), '\t'), xmlNotes, score);
  const path = `${root}/${work.id}.training-references.json`;
  const referenceBytes = JSON.stringify({ work: work.id, split: work.split, ppq: score.ppq, duration: score.duration,
    references: aligned.references, diagnostics: aligned.diagnostics,
    sources: { score: work.scoreNotes.sha256, xml: work.scoreMusicXml.sha256, labels: work.harmonicAnalysis.sha256 } }, null, 2) + '\n';
  writeFileSync(path, referenceBytes);
  return { ...prepareInput(work, root), references: { path, sha256: hash(referenceBytes), ppq: score.ppq } };
}

function run(args: string[]) {
  const holdSilentGaps = args.includes('--hold-silent-gaps');
  args = args.filter(a => a !== '--hold-silent-gaps');
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
  const surfaceAt = args.indexOf('--surface-profile');
  const surfaceProfile = surfaceAt < 0 ? undefined : args[surfaceAt + 1];
  if (surfaceAt >= 0) {
    if (!surfaceProfile || !/^[a-z0-9][a-z0-9._-]*$/.test(surfaceProfile)) throw Error('Invalid surface profile.');
    args = [...args.slice(0, surfaceAt), ...args.slice(surfaceAt + 2)];
  }
  const training = args.includes('--prepare-training');
  const prepare = training || args.includes('--prepare');
  if (args.some(a => !['--prepare', '--prepare-training', '--evaluate'].includes(a)) || args.length !== 1 || (prepare && context)
    || ((contextOptions || holdSilentGaps || surfaceProfile) && !context) || (surfaceProfile && prepare)) {
    throw Error('Usage: npx tsx scripts/compare-rnbert.ts --prepare|--prepare-training|--evaluate [--profile name] [--surface-profile name] [--context native-example-path [--context-options JSON] [--hold-silent-gaps]]. Evaluation is development-only.');
  }
  const root = '.audit/contextual/rnbert'; mkdirSync(root, { recursive: true });
  const sources = JSON.parse(readFileSync('scripts/research/rnbert-sources.json', 'utf8'));
  const registry = JSON.parse(readFileSync('docs/research/corpus-candidates.json', 'utf8'));
  const corpus = registry.evaluationSources.find((s: { id: string }) => s.id === sourceId);
  const workIds: string[] = training ? corpus?.split.training : sources.developmentWorks;
  if (!Array.isArray(workIds) || !workIds.length || new Set(workIds).size !== workIds.length) throw Error('Missing or duplicate explicit work assignments.');
  const works: Work[] = workIds.map((id: string) => {
    const work = corpus?.works.find((w: Work) => w.id === id);
    if (!work || work.split !== (training ? 'training' : 'development')) throw Error(`Work split admission failed: ${id}`);
    return work;
  });
  if (prepare) {
    const results = works.map(work => training ? prepareTraining(work, root) : prepareInput(work, root));
    const policy = training ? 'Explicitly assigned training only; exact observations and separate supervised labels. No development or holdout references read.'
      : 'Zero-duration notes excluded explicitly; source positive events unchanged. No labels/keys/boundaries read.';
    writeFileSync(`${root}/${training ? 'training-' : ''}admission.json`, JSON.stringify({ policy, works: results }, null, 2) + '\n');
    console.log(`Prepared ${results.length} ${training ? 'training observations and separate references' : 'development observations; no references read'}.`); return;
  }
  const originalProfile = mappedProfile(root, profile, works);
  const correctedProfile = surfaceProfile ? mappedProfile(root, surfaceProfile, works) : undefined;
  // Complete and hash every optional refinement before opening reference labels.
  const prepared = works.map(work => {
    const { path, prediction, predictionSha256, score, scoreSha256 } = originalProfile.inputs.get(work.id)!;
    if (prediction.windows.some(w => w.functionalRoot)) throw Error('Mapped input already contains contextual refinement; use the raw model profile.');
    if (!context) return { work, path, prediction, predictionSha256 };
    const { refined, spanBaseline, evidence } = refineContext(context, score, prediction, contextOptions, holdSilentGaps);
    const refinedPath = `${root}/${work.id}-${profile}${holdSilentGaps ? '-hold' : ''}-context-predictions.json`, refinedBytes = JSON.stringify(refined, null, 2) + '\n';
    writeFileSync(refinedPath, refinedBytes);
    let factored: { path: string; sha256: string; prediction: HarmonyPrediction } | undefined;
    if (surfaceProfile) {
      const { path: surfacePath, prediction: surface, predictionSha256: surfaceSha256 } = correctedProfile!.inputs.get(work.id)!;
      if (surface.windows.some(w => w.functionalRoot)) throw Error('Surface input cannot contain native functional proofs.');
      const held = holdSilentGaps ? holdSurface(context, score, surface) : { prediction: surface, evidence: null };
      const projection = projectHarmonyLayers(refined, held.prediction, score.duration);
      const artifact = { work: work.id, ppq: score.ppq, duration: score.duration, sourceScoreSha256: scoreSha256,
        method: 'Immutable original functional layer and independently adapted realized core/color. The metric projection is not a native functional proof.',
        layers: {
          function: { path: refinedPath, sha256: hash(refinedBytes), prediction: refined },
          surface: { inputPath: surfacePath, inputSha256: surfaceSha256, prediction: held.prediction, hold: held.evidence },
        }, ...projection };
      const path = `${root}/${work.id}-${profile}-with-${surfaceProfile}-layers.json`, bytes = JSON.stringify(artifact) + '\n';
      writeFileSync(path, bytes); factored = { path, sha256: hash(bytes), prediction: projection.prediction };
    }
    return { work, path, prediction, predictionSha256, refined, refinedPath, refinedSha256: hash(refinedBytes),
      spanBaseline, evidence, sourceScore: score, sourceScoreSha256: scoreSha256, factored };
  });
  const results = prepared.map(item => {
    const { work, prediction, predictionSha256 } = item;
    const { score, references, diagnostics } = loadDevelopment(work);
    if (item.sourceScore && !isDeepStrictEqual(item.sourceScore, score)) throw Error('Context and evaluation observation Scores disagree.');
    const evaluated = item.refined ?? prediction;
    const rawMetrics = compactHarmonyMetrics(evaluateHarmony(prediction, references, score.ppq, score.duration));
    const metrics = item.refined ? compactHarmonyMetrics(evaluateHarmony(evaluated, references, score.ppq, score.duration)) : rawMetrics;
    const spanMetrics = item.spanBaseline ? compactHarmonyMetrics(evaluateHarmony(item.spanBaseline, references, score.ppq, score.duration)) : rawMetrics;
    if (metrics.referenceTicks !== rawMetrics.referenceTicks || metrics.selectedTicks !== spanMetrics.selectedTicks
      || metrics.coreCorrectTicks !== spanMetrics.coreCorrectTicks) throw Error('Context refinement changed its admitted spans or realized core.');
    const finalPrediction = item.factored?.prediction ?? evaluated;
    const finalMetrics = item.factored ? compactHarmonyMetrics(evaluateHarmony(finalPrediction, references, score.ppq, score.duration)) : metrics;
    if (finalMetrics.referenceTicks !== metrics.referenceTicks) throw Error('Factored evaluation changed the reference denominator.');
    return { id: work.id, trainingOverlap: true, predictionPath: item.path, predictionSha256,
      modelWindows: prediction.windows.length, metrics: finalMetrics, errors: diagnosePredictionErrors(finalPrediction, references, score.ppq), diagnostics,
      ...(item.factored ? { originalFunctionMetrics: metrics, factoredPath: item.factored.path, factoredSha256: item.factored.sha256, surfaceProfile } : {}),
      ...(item.refined ? { rawMetrics, ...(holdSilentGaps ? { heldMetrics: spanMetrics } : {}), rawErrors: diagnosePredictionErrors(prediction, references, score.ppq),
        refinedPath: item.refinedPath, refinedSha256: item.refinedSha256, sourceScoreSha256: item.sourceScoreSha256, context: item.evidence } : {}) };
  });
  const report = { experiment: 'Official RNBert training-overlap development diagnostic, not generalization.', profile,
    input: 'Projected notation-time MIDI; upstream quantization/detremolo/salami-slicing/dedoubling. No supplied key or chord labels/boundaries.',
    mapping: 'Author atomic RN root translation plus diatonic-default secondary-mode table and CAUTIONARY minor6/7. Explicit predicted quality supplies realized core, independently of functional root.',
    context: context ? { executable: resolve(context), executableSha256: hash(readFileSync(context)),
      adapterSourceSha256: hash(readFileSync('crates/muzak-core/examples/harmony-context.rs')),
      ruleSourceSha256: hash(readFileSync('crates/muzak-core/src/harmony_context.rs')),
      method: 'Rust observed-bass context with explicit returned parameters and optional inferred-resolution dependencies, accepting proposals only when the realized root equals predicted model-key tonic. No key inference or reference inputs. Context changes functional root only; realized core and admitted spans are fixed.',
      silencePolicy: holdSilentGaps ? 'Before context inference, extend selected windows only across verified pitched silence to the next window or source end. Every extension is recorded; observations and strict denominator stay fixed.' : 'Model spans unchanged.',
      ...(holdSilentGaps ? { holdSourceSha256: hash(readFileSync('crates/muzak-core/examples/support/silent_gap_hold.rs')) } : {}),
      adapter: 'Uncomputed role arrays are empty and fit scalars0; these are not scene/evidence claims. requireFullCore=false; no proposal consults uncomputed coverage.',
    } : null,
    sourcesManifest: 'scripts/research/rnbert-sources.json', modelManifest: `${root}/model-manifest.json`,
    runtimeManifest: `${root}/runtime-manifest.json`,
    ...(existsSync(`${root}/inference-runtime-${profile}.json`) ? { inferenceRuntime: `${root}/inference-runtime-${profile}.json` } : {}),
    mappingManifest: originalProfile.manifest, ...(correctedProfile ? { surfaceMappingManifest: correctedProfile.manifest } : {}),
    admission: `${root}/parser-admission.json`, evaluationSourceSha256: hash(readFileSync('scripts/evaluate-harmony.ts')), results };
  const output = surfaceProfile ? `${root}/strict-agreement-${profile}-with-${surfaceProfile}.json`
    : context ? `${root}/strict-agreement-${profile}${holdSilentGaps ? '-hold' : ''}-context.json`
    : profile === 'baseline' ? `${root}/strict-agreement.json` : `${root}/strict-agreement-${profile}.json`;
  writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(results.map(r => ({ id: r.id, joint: r.metrics.jointAccuracy, core: r.metrics.coreAccuracy, errors: r.errors })), null, 2));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) run(process.argv.slice(2));
