import { coreMethodFiles } from './core-source';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { boundaryEvidence, type BoundaryEvidence } from '../src/score/boundary-evidence';
import { evaluateBoundaries } from '../src/score/evaluation';
import type { Score } from '../src/score/score';
import { writeAuditJson } from './audit-output';

interface FamilySplit { development: string[]; holdout: string[] }
interface Definition {
  id: string; sourceUrl: string; documentationUrl: string;
  asset: { path: string; sha256: string };
  split: FamilySplit & { unit: string; rule: string };
  counts: { melodies: number; development: number; holdout: number };
}
interface Metadata { id: string; tunefamily: string }
export interface MtcFeatures { midipitch: unknown; duration_frac: unknown; IOI_frac: unknown; phrase_end: unknown }
export interface DevelopmentMelody extends Metadata { features: MtcFeatures }
export const thresholds = [0, .25, .5, .75, 1] as const;
const cueNames = ['pitch', 'ioi', 'rest'] as const;
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const methodFiles = [...coreMethodFiles(), 'scripts/core-source.ts', 'scripts/evaluate-boundaries.ts', 'src/score/boundary-evidence.ts', 'src/score/evaluation.ts',
  'src/score/score.ts', 'src/score/operations.ts', 'src/score/trajectories.ts', 'src/score/midi-file.ts'];

function validateSplit(split: FamilySplit): void {
  const families = [...split.development, ...split.holdout];
  if (!split.development.length || !split.holdout.length || families.some(id => typeof id !== 'string' || !id)
    || new Set(families).size !== families.length) throw new Error('Invalid or overlapping tune-family split.');
}

/** Gate on the metadata prefix BEFORE parsing any feature values. An invalid
 * held-out feature suffix is deliberately never parsed or inspected. The
 * verified asset hash and registered split identify the actual source edition. */
export function gateMtcLine(line: string, split: FamilySplit):
  { partition: 'holdout'; metadata: Metadata } | { partition: 'development'; melody: DevelopmentMelody } {
  validateSplit(split);
  const delimiter = /"features"\s*:/.exec(line);
  if (!delimiter) throw new Error('Missing features delimiter in MTC record.');
  const prefix = line.slice(0, delimiter.index);
  if (!/,\s*$/.test(prefix)) throw new Error('Malformed MTC metadata prefix.');
  let metadata: Metadata;
  try { metadata = JSON.parse(prefix.replace(/,\s*$/, '}')); }
  catch { throw new Error('Malformed MTC metadata prefix.'); }
  if (typeof metadata.id !== 'string' || !metadata.id || typeof metadata.tunefamily !== 'string' || !metadata.tunefamily)
    throw new Error('MTC metadata needs melody and tune-family IDs.');
  const identity = { id: metadata.id, tunefamily: metadata.tunefamily };
  if (split.holdout.includes(metadata.tunefamily)) return { partition: 'holdout', metadata: identity };
  if (!split.development.includes(metadata.tunefamily)) throw new Error('MTC tune family is absent from the frozen split.');
  const parsed = JSON.parse(line);
  if (parsed.id !== identity.id || parsed.tunefamily !== identity.tunefamily || !parsed.features || typeof parsed.features !== 'object')
    throw new Error('Development record disagrees with gated metadata.');
  const { midipitch, duration_frac, IOI_frac, phrase_end } = parsed.features;
  return { partition: 'development', melody: { ...identity, features: { midipitch, duration_frac, IOI_frac, phrase_end } } };
}

type Rational = { n: bigint; d: bigint };
const gcd = (a: bigint, b: bigint): bigint => b ? gcd(b, a % b) : a;
function fraction(value: unknown, label: string): Rational {
  if (typeof value !== 'string' || !/^\d+(?:\/[1-9]\d*)?$/.test(value)) throw new Error(`Invalid ${label} rational.`);
  const [n, d = 1n] = value.split('/').map(BigInt), divisor = gcd(n, d);
  return { n: n / divisor, d: d / divisor };
}
function safe(value: bigint): number {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('MTC rational time exceeds safe Score coordinates.');
  return Number(value);
}

/** Source units and indexing: MTCFeatures 1.1 melodyrepresentation.html.
 * duration_frac and IOI_frac are quarter lengths. IOI[i] leads to attack i+1;
 * final IOI is ignored. Ties are already merged; do not expand/merge them again.
 * Only these three observational fields enter Score; phrase_end stays outside. */
export function mtcScore(features: MtcFeatures): { score: Score; trailingIoiIgnored: boolean } {
  const pitches = features.midipitch, durations = features.duration_frac, iois = features.IOI_frac;
  if (!Array.isArray(pitches) || !pitches.length || !Array.isArray(durations) || !Array.isArray(iois)
    || durations.length !== pitches.length || iois.length !== pitches.length) throw new Error('MTC pitch/duration/IOI sequences need equal nonzero lengths.');
  if (pitches.some(pitch => !Number.isInteger(pitch) || pitch < 0 || pitch > 127)) throw new Error('Invalid MTC MIDI pitch.');
  const d = durations.map(value => fraction(value, 'duration')), gaps = iois.slice(0, -1).map(value => fraction(value, 'IOI'));
  if (gaps.some(gap => gap.n === 0n)) throw new Error('Nonpositive IOI: a strict attack sequence is required.');
  let ppq = 1n;
  for (const value of [...d, ...gaps]) { ppq = ppq / gcd(ppq, value.d) * value.d; safe(ppq); }
  const ticks = (value: Rational) => value.n * (ppq / value.d);
  let onset = 0n, end = 0n;
  const notes = pitches.map((pitch: number, i: number) => {
    const duration = ticks(d[i]), finish = onset + duration;
    if (finish > end) end = finish;
    const note = { id: `note-${i}`, part: 'melody', onset: safe(onset), duration: safe(duration),
      pitch: { millicents: pitch * 100000 }, velocity: 80, releaseVelocity: 64 };
    if (i < gaps.length) onset += ticks(gaps[i]);
    return note;
  });
  const duration = safe(end);
  return { score: { ppq: safe(ppq), duration, trackEnds: [duration], notes, attachments: [],
    parts: [{ id: 'melody', name: 'MTC melody', track: 0, channel: 0, percussion: false }] },
    trailingIoiIgnored: iois.at(-1) !== null };
}

/** Every preset is reported, including ties at the threshold. Zero means any
 * positive evidence, not every zero-strength gap. No peak picking or top-count. */
export function boundarySweep(evidence: BoundaryEvidence) {
  if (evidence.status !== 'supported') throw new Error('Boundary sweep requires supported monophonic evidence.');
  return [
    ...cueNames.flatMap(cue => thresholds.map(threshold => ({ method: cue as string, threshold: threshold as number | null,
      boundaries: evidence.gaps.flatMap((gap, i) => gap[cue].normalized > 0 && gap[cue].normalized >= threshold ? [i + 1] : []) }))),
    { method: 'all-gaps', threshold: null, boundaries: evidence.gaps.map((_, i) => i + 1) },
    { method: 'rest-present', threshold: null, boundaries: evidence.gaps.flatMap((gap, i) => gap.raw.restTicks > 0 ? [i + 1] : []) },
    { method: 'none', threshold: null, boundaries: [] as number[] },
  ];
}

export function evaluateMtcMelody(melody: DevelopmentMelody) {
  const { id, tunefamily, features } = melody;
  const { score, trailingIoiIgnored } = mtcScore(features);
  const labels = features.phrase_end;
  if (!Array.isArray(labels) || labels.length !== score.notes.length || labels.some(value => typeof value !== 'boolean'))
    throw new Error('MTC phrase_end labels must be booleans aligned with notes.');
  const evidence = boundaryEvidence(score, { parts: ['melody'] });
  const common = { id, tunefamily, notes: score.notes.length, ppq: score.ppq, scoreDurationTicks: score.duration,
    trailingIoiIgnored, finalPhraseEndExcluded: labels.at(-1) === true };
  if (evidence.status !== 'supported') return { ...common, status: 'unsupported' as const, issues: evidence.issues };
  // An end flag at note i marks the gap whose right attack is note i+1. The
  // final note has no following attack and is excluded, regardless of its flag.
  const boundaries = labels.slice(0, -1).flatMap((label, i) => label ? [i + 1] : []);
  const options = { unit: 'note-gap-index', tolerance: 0, span: [0, score.notes.length] as const, endpoints: 'exclude' as const };
  return { ...common, status: 'evaluated' as const, gaps: evidence.gaps.length, referenceBoundaries: boundaries,
    rightAttackTicks: evidence.gaps.map(gap => gap.tick), cueParameters: evidence.parameters,
    evaluations: boundarySweep(evidence).map(prediction => {
      const metric = evaluateBoundaries(prediction.boundaries, [{ id, boundaries }], options)[0];
      return { method: prediction.method, threshold: prediction.threshold, matched: metric.matches.length,
        estimated: metric.estimatedCount, reference: metric.referenceCount,
        precision: metric.precision, recall: metric.recall, f1: metric.f1 };
    }) };
}

export function summarizeBoundaries(results: ReturnType<typeof evaluateMtcMelody>[]) {
  const evaluated = results.filter(result => result.status === 'evaluated');
  const sums = new Map<string, { method: string; threshold: number | null; matched: number; estimated: number; reference: number }>();
  for (const result of evaluated) for (const metric of result.evaluations) {
    const key = `${metric.method}:${metric.threshold}`, total = sums.get(key)
      ?? { method: metric.method, threshold: metric.threshold, matched: 0, estimated: 0, reference: 0 };
    total.matched += metric.matched; total.estimated += metric.estimated; total.reference += metric.reference; sums.set(key, total);
  }
  return { evaluatedMelodies: evaluated.length, unsupportedMelodies: results.length - evaluated.length,
    noteGaps: evaluated.reduce((sum, result) => sum + result.gaps, 0),
    melodiesWithoutInteriorReferenceBoundaries: evaluated.filter(result => !result.referenceBoundaries.length).length,
    micro: [...sums.values()].map(total => {
      const precision = total.estimated ? total.matched / total.estimated : 1, recall = total.reference ? total.matched / total.reference : 1;
      return { ...total, falsePositive: total.estimated - total.matched, falseNegative: total.reference - total.matched,
        precision, recall, f1: precision + recall ? 2 * precision * recall / (precision + recall) : 0 };
    }) };
}

function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--method-digest' && !arg.startsWith('--out='))) throw new Error('Only --method-digest and --out=PATH are supported; held-out evaluation is unavailable.');
  const registry = JSON.parse(readFileSync('docs/research/corpus-candidates.json', 'utf8'));
  const definition: Definition = registry.evaluationSources?.find((source: Definition) => source.id === 'mtc-ann-features-1.1');
  if (!definition) throw new Error('MTC boundary benchmark is absent from the registry.');
  validateSplit(definition.split);
  const methodDigest = hash(methodFiles.map(path => `${path}:${hash(readFileSync(path))}\n`).join('') + JSON.stringify({ definition, thresholds }));
  if (args.includes('--method-digest')) { console.log(methodDigest); return; }
  const compressed = readFileSync(definition.asset.path);
  if (hash(compressed) !== definition.asset.sha256) throw new Error('MTC asset hash differs from registered edition.');
  const results: ReturnType<typeof evaluateMtcMelody>[] = [], rejected: Array<Metadata & { reason: string }> = [];
  const identities = new Set<string>(); let heldoutRecordsSkipped = 0, developmentRecordsParsed = 0;
  for (const line of gunzipSync(compressed).toString('utf8').split(/\r?\n/).filter(line => line.trim())) {
    const gated = gateMtcLine(line, definition.split), metadata = gated.partition === 'holdout' ? gated.metadata : gated.melody;
    if (identities.has(metadata.id)) throw new Error('Duplicate MTC melody ID.'); identities.add(metadata.id);
    if (gated.partition === 'holdout') { heldoutRecordsSkipped++; continue; }
    developmentRecordsParsed++;
    try { results.push(evaluateMtcMelody(gated.melody)); }
    catch (error) { rejected.push({ id: metadata.id, tunefamily: metadata.tunefamily, reason: error instanceof Error ? error.message : String(error) }); }
  }
  if (developmentRecordsParsed !== definition.counts.development || heldoutRecordsSkipped !== definition.counts.holdout
    || identities.size !== definition.counts.melodies) throw new Error('MTC record counts differ from frozen split.');
  const output = writeAuditJson(args.find(arg => arg.startsWith('--out='))?.slice(6) ?? '.audit/score/boundary-benchmark.json', {
    task: 'Development-only association of separate local boundary cues with encoded MTC score phrase-end labels; no model training or threshold selection.',
    date: new Date().toISOString(), methodDigest, methodFiles, source: definition.asset, sourceUrl: definition.sourceUrl,
    documentationUrl: definition.documentationUrl, split: definition.split, thresholds,
    inputFields: ['midipitch', 'duration_frac', 'IOI_frac'], labelField: 'phrase_end',
    metric: { unit: 'note-gap-index', tolerance: 0, endpoints: 'exclude', referenceRule: 'phrase_end[i] marks the next attack i+1; final-note label excluded.',
      thresholdRule: 'Positive normalized strength >= threshold; threshold zero means strictly positive.',
      emptyConvention: 'No predictions: precision1; no references: recall1; both empty:F1=1; one-sided empty:F1=0.' },
    access: { developmentRecordsParsed, heldoutRecordsSkipped, heldoutFeatureRecordsParsed: 0 },
    assumptions: ['Quarter-length rational durations/IOIs reconstruct first onset at zero; onsettick is not used.',
      'The source has already merged ties and omitted grace/rest events; no note or voice inference is attempted.',
      'Each melody supplies one encoded phrase_end sequence; no multi-annotator boundary consensus is asserted.',
      'Final IOI, if present, is ignored; final note duration remains. Velocity80/release64 are placeholders, not performance fidelity.',
      'Strict monophony diagnostics are unchanged; invalid/nonpositive IOIs and overlapping notes are surfaced, not repaired.',
      'Cue caps and maximum normalization are explicit defaults; normalization uses the full selected melody, not a causal prediction window.',
      'Rest cues may reflect transcribed phrase/lyric line endings. They are reported separately and do not establish independent phrasing understanding.',
      'All fixed thresholds and trivial baselines are reported. Micro counts weight melodies by their boundary/prediction counts; no best threshold, significance or held-out result is claimed.',
      'Folk-melody development association does not establish progressive/jazz phrase inference or musical quality.'],
    summary: { ...summarizeBoundaries(results), rejectedMelodies: rejected.length }, rejected, melodies: results,
  });
  console.log(output);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
