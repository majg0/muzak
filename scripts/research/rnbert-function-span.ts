/** Offline, model-assisted continuation. Original windows and native proofs stay immutable. */
import type { Score } from '../../src/score/score';
import type { HarmonyPrediction } from '../evaluate-harmony';
import type { HarmonyWindow } from '../../src/core/generated/HarmonyWindow';
import type { HarmonyFunctionalRoot } from '../../src/core/generated/HarmonyFunctionalRoot';
import type { HarmonyContextOptions } from '../../src/core/generated/HarmonyContextOptions';

const OCTAVE = 1_200_000;
const pc = (p: number) => ((p % OCTAVE) + OCTAVE) % OCTAVE;
function ensure(condition: unknown, message: string): asserts condition { if (!condition) throw Error(message); }
type Prediction = { windows: Array<HarmonyPrediction['windows'][number] & { tonicPitchClass?: number | null; rest?: boolean }> };
export interface NumericFactorFrame { startTick: number; endTick: number; states: Array<{ root: number; core: number[]; inversion: number }> }
export interface FunctionSpanEvidence { path: string; sha256: string; ppq: number; frames: NumericFactorFrame[] }
export interface FunctionSpanOptions { maxContinuationTicks?: number; maxEvidenceVisits?: number; maxNativeProofs?: number }
export interface FunctionSpanProof {
  pairWindows: HarmonyWindow[];
  nativeProposal: { windowIndex: number; functionalRoot: HarmonyFunctionalRoot };
  parameters: HarmonyContextOptions; inputSha256: string; nativeExecutableSha256: string;
}
type Bass = { bassMillicents: number; bassNoteIds: string[] };
export interface FunctionSpanRecord {
  id: string; startTick: number; endTick: number; rootMillicents: number;
  seed: { windowIndex: number; selectedAlternativeIndex: number };
  resolution: { windowIndex: number; selectedAlternativeIndex: number };
  continuationWindows: Array<Bass & { windowIndex: number; selectedAlternativeIndex: number; startTick: number; endTick: number }>;
  numericHeadWitnesses: { source: { path: string; sha256: string }; uniformInversion: 2; frames: NumericFactorFrame[] };
  endpointProof: FunctionSpanProof & { localToGlobalWindowIndices: [number, number] };
}

const chosen = (w: Prediction['windows'][number]) => {
  if (w.selected === null) return null;
  ensure(Number.isSafeInteger(w.selected) && w.selected >= 0 && !!w.alternatives[w.selected], 'Invalid selected function hypothesis.');
  return w.alternatives[w.selected];
};
const canonical = (values: number[]) => [...new Set(values.map(pc))].sort((a, b) => a - b);
const equal = (a: number[], b: number[]) => a.length === b.length && a.every((v, i) => v === b[i]);
const identity = (w: Prediction['windows'][number]) => {
  const h = chosen(w); return h ? JSON.stringify([h.rootMillicents, canonical(h.coreIntervals), canonical(h.colorIntervals)]) : null;
};
const hashValid = (value: string) => /^[0-9a-f]{64}$/.test(value);

function validateEndpointWitnesses(proof: FunctionSpanProof, notes: ReadonlyMap<string, Score['notes'][number]>,
  percussion: ReadonlySet<string>, root: number, charge: (amount: number) => void) {
  const [seed, resolution] = proof.pairWindows, evidence = proof.nativeProposal.functionalRoot.evidence;
  ensure(evidence.bassMillicents === root, 'Endpoint proof bass differs from its functional root.');
  const members = (ids: string[], start: number, end: number) => {
    charge(ids.length);
    ensure(ids.length > 0 && new Set(ids).size === ids.length, 'Endpoint proof needs distinct source witnesses.');
    return ids.map(id => {
      const n = notes.get(id);
      ensure(n && !percussion.has(n.part) && n.duration > 0 && n.onset < end && n.onset + n.duration > start,
        'Endpoint proof witness does not overlap its source interval.');
      return n;
    });
  };
  for (const [window, tick, ids] of [[seed, evidence.currentBassTick, evidence.currentBassNoteIds],
    [resolution, evidence.nextBassTick, evidence.nextBassNoteIds]] as const) {
    ensure(Number.isSafeInteger(tick) && tick >= window.startTick && tick < window.endTick, 'Endpoint proof bass tick lies outside its source window.');
    for (const n of members(ids, window.startTick, window.endTick)) {
      ensure(n.onset <= tick && n.onset + n.duration > tick && pc(n.pitch.millicents) === root
        && !n.pitchEnvelope?.some(k => k.pitch.millicents !== n.pitch.millicents), 'Endpoint proof bass witness is not sounding at the claimed tick and pitch.');
    }
  }
  ensure(Number.isSafeInteger(evidence.resolutionEndTick) && evidence.resolutionEndTick > resolution.startTick
    && evidence.resolutionEndTick <= resolution.endTick, 'Endpoint proof resolution extent lies outside its source window.');
  members(evidence.resolutionNoteIds, resolution.startTick, evidence.resolutionEndTick);
}

/** Only direct selected numeric states are admitted; no display-token inference. */
export function inferFunctionSpans(score: Score, prediction: Prediction, evidence: FunctionSpanEvidence,
  provePair: (seedIndex: number, resolutionIndex: number) => FunctionSpanProof | null, options: FunctionSpanOptions = {}) {
  const parameters = { maxContinuationTicks: options.maxContinuationTicks ?? 2 * score.ppq,
    maxEvidenceVisits: options.maxEvidenceVisits ?? 2_000_000, maxNativeProofs: options.maxNativeProofs ?? 20_000 };
  ensure(Number.isSafeInteger(score.ppq) && score.ppq > 0 && Number.isSafeInteger(score.duration) && score.duration >= 0, 'Invalid source timebase.');
  for (const value of Object.values(parameters)) ensure(Number.isSafeInteger(value) && value > 0, 'Invalid continuation bound.');
  ensure(parameters.maxEvidenceVisits <= 20_000_000 && parameters.maxNativeProofs <= 100_000, 'Continuation bound exceeds admission limit.');
  ensure(evidence.ppq === score.ppq && !!evidence.path && hashValid(evidence.sha256), 'Numeric evidence identity/timebase missing.');
  ensure(score.notes.length + prediction.windows.length + evidence.frames.length <= parameters.maxEvidenceVisits, 'Function continuation evidence budget exceeded.');
  let previous = 0;
  for (const f of evidence.frames) {
    ensure(Number.isSafeInteger(f.startTick) && Number.isSafeInteger(f.endTick) && f.startTick >= previous && f.endTick > f.startTick && f.endTick <= score.duration, 'Invalid numeric evidence geometry.');
    ensure(f.states.length <= 1, 'Continuation requires actual selected-state evidence, not an alternative inventory.');
    for (const s of f.states) ensure(Number.isSafeInteger(s.root) && s.root >= 0 && s.root < OCTAVE
      && Number.isSafeInteger(s.inversion) && s.inversion >= 0 && s.inversion <= 3
      && s.core.every(p => Number.isSafeInteger(p) && p >= 0 && p < OCTAVE) && equal(s.core, canonical(s.core)), 'Invalid numeric state.');
    previous = f.endTick;
  }
  const windows = prediction.windows;
  previous = 0;
  for (const w of windows) {
    ensure(Number.isSafeInteger(w.startTick) && Number.isSafeInteger(w.endTick) && w.startTick >= previous && w.endTick > w.startTick && w.endTick <= score.duration, 'Invalid function window geometry.');
    const h = chosen(w);
    if (h) ensure(Number.isSafeInteger(h.rootMillicents) && h.rootMillicents >= 0 && h.rootMillicents < OCTAVE
      && [...h.coreIntervals, ...h.colorIntervals].every(p => Number.isSafeInteger(p) && Number.isSafeInteger(p + h.rootMillicents)), 'Invalid realization pitch.');
    previous = w.endTick;
  }
  let visits = windows.length + evidence.frames.length, proofCalls = 0, cursor = 0;
  const charge = (amount: number) => { visits += amount; ensure(visits <= parameters.maxEvidenceVisits, 'Function continuation evidence budget exceeded.'); };
  charge(0);
  const percussion = new Set(score.parts.filter(p => p.percussion).map(p => p.id));
  charge(score.notes.length);
  const notesById = new Map(score.notes.map(n => [n.id, n]));
  ensure(notesById.size === score.notes.length, 'Duplicate source note identity.');
  const notes = score.notes.filter(n => n.duration > 0 && !percussion.has(n.part)).sort((a, b) => a.onset - b.onset);
  let active: Score['notes'] = [];
  const observations: Array<Bass | null> = [];
  for (const w of windows) {
    while (cursor < notes.length && notes[cursor].onset < w.endTick) active.push(notes[cursor++]);
    charge(active.length); active = active.filter(n => n.onset + n.duration > w.startTick);
    if (!active.length || active.some(n => n.pitch.millicents % 100_000 !== 0 || n.pitchEnvelope?.some(k => k.pitch.millicents !== n.pitch.millicents))) { observations.push(null); continue; }
    const lowest = active.reduce((m, n) => Math.min(m, n.pitch.millicents), Infinity);
    observations.push({ bassMillicents: pc(lowest), bassNoteIds: active.filter(n => n.pitch.millicents === lowest).map(n => n.id).sort() });
  }
  function numericWitnesses(index: number) {
    const w = windows[index], h = chosen(w)!; let next = w.startTick;
    const core = canonical(h.coreIntervals.map(p => p + h.rootMillicents)), frames: NumericFactorFrame[] = [];
    // Binary search avoids rescanning a work for every prospective seed.
    let lo = 0, hi = evidence.frames.length;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (evidence.frames[mid].endTick <= next) lo = mid + 1; else hi = mid; }
    for (let k = lo; k < evidence.frames.length && evidence.frames[k].startTick < w.endTick; k++) {
      charge(1); const f = evidence.frames[k], a = Math.max(f.startTick, w.startTick), b = Math.min(f.endTick, w.endTick), s = f.states[0];
      if (a !== next || b <= a || !s || s.root !== h.rootMillicents || !equal(s.core, core) || s.inversion !== 2) return null;
      frames.push(structuredClone(f)); next = b;
    }
    return next === w.endTick ? frames : null;
  }
  const records: FunctionSpanRecord[] = [];
  for (let i = 0; i < windows.length; i++) {
    const seed = windows[i], h = chosen(seed), bass = observations[i];
    if (seed.functionalRoot || seed.rest || !h || !bass || seed.tonicPitchClass !== h.rootMillicents) continue;
    const relative = canonical(h.coreIntervals.map(p => h.rootMillicents + p - bass.bassMillicents));
    if (!equal(relative, [0, 500_000, 800_000]) && !equal(relative, [0, 500_000, 900_000])) continue;
    const numeric = numericWitnesses(i); if (!numeric) continue;
    const key = identity(seed), continuation: FunctionSpanRecord['continuationWindows'] = [];
    for (let j = i + 1; j < windows.length; j++) {
      charge(1); const w = windows[j], o = observations[j], selected = chosen(w);
      if (w.startTick !== windows[j - 1].endTick || w.startTick - seed.endTick > parameters.maxContinuationTicks || w.rest || !selected || !o || o.bassMillicents !== bass.bassMillicents) break;
      if (identity(w) === key) {
        if (w.tonicPitchClass !== seed.tonicPitchClass) break;
        continuation.push({ windowIndex: j, selectedAlternativeIndex: w.selected!, startTick: w.startTick, endTick: w.endTick, ...o }); continue;
      }
      if (continuation.length) {
        ensure(++proofCalls <= parameters.maxNativeProofs, 'Function continuation proof budget exceeded.');
        const proof = provePair(i, j);
        if (proof) {
          const proposal = proof.nativeProposal, f = proposal.functionalRoot;
          ensure(proposal.windowIndex === 0 && f.evidence.nextWindowIndex === 1 && f.realizationAlternativeIndex === seed.selected && f.rootMillicents === bass.bassMillicents, 'Endpoint proof does not support this seed.');
          ensure(hashValid(proof.inputSha256) && hashValid(proof.nativeExecutableSha256) && proof.pairWindows.length === 2, 'Endpoint proof provenance missing.');
          for (const [local, global] of [[0, i], [1, j]]) {
            const p = proof.pairWindows[local], original = windows[global];
            ensure(p.startTick === original.startTick && p.endTick === original.endTick && p.selected === original.selected && identity(p) === identity(original), 'Endpoint proof changed its projected source windows.');
          }
          validateEndpointWitnesses(proof, notesById, percussion, bass.bassMillicents, charge);
          records.push({ id: `function-span-${i}`, startTick: seed.startTick, endTick: seed.endTick, rootMillicents: f.rootMillicents,
            seed: { windowIndex: i, selectedAlternativeIndex: seed.selected! }, resolution: { windowIndex: j, selectedAlternativeIndex: w.selected! },
            continuationWindows: continuation, numericHeadWitnesses: { source: { path: evidence.path, sha256: evidence.sha256 }, uniformInversion: 2, frames: numeric },
            endpointProof: { ...structuredClone(proof), localToGlobalWindowIndices: [i, j] } });
        }
      }
      break; // Never skip a contradictory intervening realization.
    }
  }
  return { records, parameters, work: { evidenceVisits: visits, nativeProofCalls: proofCalls } };
}
