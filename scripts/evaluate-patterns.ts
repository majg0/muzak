import { coreMethodFiles } from './core-source';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateOccurrences, MAX_OCCURRENCES, type Occurrence as MembershipOccurrence } from '../src/score/evaluation';
import { validateScore, type Score, type ScoreNote } from '../src/score/score';
import { callCoreSync } from '../src/core/sync';
import assert from 'node:assert/strict';
import { writeAuditJson } from './audit-output';

interface RegisteredWork { id: string; split: 'development' | 'holdout'; asset: { path: string; sha256: string }; exactSourcePath: string; annotationPath: string }
interface BenchmarkDefinition { id: string; root: string; splitRule: string; annotationDirectories: string[]; works: RegisteredWork[] }
export function benchmarkDefinition(): BenchmarkDefinition {
  const registry = JSON.parse(readFileSync('docs/research/corpus-candidates.json', 'utf8'));
  const definition = registry.evaluationSources?.find((source: BenchmarkDefinition) => source.id === 'jkupdd-aug2013');
  if (!definition) throw new Error('JKUPDD evaluation source is absent from the corpus registry.');
  return definition;
}
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const gcd = (a: number, b: number): number => b ? gcd(b, a % b) : Math.abs(a);
const lcm = (a: number, b: number) => {
  const value = a / gcd(a, b) * b;
  if (!Number.isSafeInteger(value)) throw new Error('Rational timebase exceeds exact integers.');
  return value;
};
interface Rational { numerator: number; denominator: number }
interface PairedRows { values: number[][]; rational: Rational[][]; roundedTimeValues: number; maximumTimeRounding: number }
interface Occurrence { id: string; members: string[]; duplicatePoints: number }
interface Family { id: string; annotator: string; occurrences: Occurrence[] }
export interface DiscoveryMembership { id: string; occurrences: MembershipOccurrence[] }

/** Compare complete proposed families, retaining the algorithm's ranking.
 * Best-per-reference selection is an oracle diagnostic, never model output. */
export function evaluateDiscoveredMemberships(candidates: DiscoveryMembership[], references: Array<{ id: string; annotator: string; occurrences: MembershipOccurrence[] }>,
  maxEstimatedAssignmentWork = 50_000_000) {
  if (!Number.isSafeInteger(maxEstimatedAssignmentWork) || maxEstimatedAssignmentWork < 0) throw new Error('Invalid assignment-work budget.');
  if (new Set(candidates.map(candidate => candidate.id)).size !== candidates.length) throw new Error('Candidate IDs must be unique.');
  const unsupportedReferences = references.filter(reference => reference.occurrences.length > MAX_OCCURRENCES)
    .map(reference => ({ referenceId: reference.id, reason: `Exceeds ${MAX_OCCURRENCES}-occurrence assignment limit.` }));
  const eligibleReferences = references.filter(reference => reference.occurrences.length <= MAX_OCCURRENCES);
  let estimatedAssignmentWork = 0;
  const unsupportedCandidates: Array<{ candidateId: string; rank: number; reason: string }> = [];
  const scored = candidates.flatMap((candidate, index) => {
    const work = eligibleReferences.reduce((sum, reference) => sum + Math.max(candidate.occurrences.length, reference.occurrences.length) ** 3, 0);
    const reason = !eligibleReferences.length ? 'No reference is within metric occurrence limits.'
      : candidate.occurrences.length > MAX_OCCURRENCES ? `Exceeds ${MAX_OCCURRENCES}-occurrence assignment limit.`
      : work + estimatedAssignmentWork > maxEstimatedAssignmentWork ? 'Exceeds declared cumulative assignment-work budget.' : undefined;
    if (reason) { unsupportedCandidates.push({ candidateId: candidate.id, rank: index + 1, reason }); return []; }
    estimatedAssignmentWork += work;
    return [{ candidateId: candidate.id, rank: index + 1, metrics: evaluateOccurrences(candidate.occurrences, eligibleReferences) }];
  });
  const prefixes = [...new Set([1, 5, 10, 24, 50, candidates.length].filter(k => k > 0 && k <= candidates.length))];
  return {
    interpretation: 'Posthoc oracle selection of one complete candidate family per annotation; not autonomous family assignment, overall discovery precision/recall, MIREX, or salience.',
    assignmentBudget: { maxOccurrences: MAX_OCCURRENCES, maxEstimatedAssignmentWork, estimatedAssignmentWork,
      workUnit: 'sum over candidate/reference pairs of max(occurrence counts)^3; assignment dimension proxy excluding membership-intersection cost' },
    candidatesScored: scored.length, unsupportedCandidates, unsupportedReferences,
    families: references.map(reference => {
      const ranked = scored.flatMap(candidate => {
        const metrics = candidate.metrics.find(result => result.referenceId === reference.id);
        return metrics ? [{ candidateId: candidate.candidateId, rank: candidate.rank, metrics }] : [];
      })
        .sort((a, b) => b.metrics.f1 - a.metrics.f1 || a.rank - b.rank);
      return { family: reference.id, annotator: reference.annotator, referenceOccurrences: reference.occurrences.length,
        referenceMemberships: reference.occurrences.reduce((sum, occurrence) => sum + occurrence.members.length, 0),
        oracleBestCandidate: ranked[0] ?? null,
        oracleBestByPrefix: prefixes.map(k => ({ k, evaluatedCandidateCount: ranked.filter(candidate => candidate.rank <= k).length,
          bestCandidate: ranked.find(candidate => candidate.rank <= k) ?? null })) };
    }),
  };
}
export interface BenchmarkWork {
  work: string; score: Score; families: Family[]; pickupShiftTicks: number;
  points: Map<string, ScoreNote[]>;
  source: { csvPath: string; csvSha256: string; lispPath: string; lispSha256: string };
  statistics: { sourceRows: number; coincidentPointCollisions: number; families: number; occurrences: number;
    roundedCsvTimeValues?: number; maximumCsvTimeRoundingQuarters?: number };
}

/** CSV is the public interchange; paired Lisp supplies exact rational times.
 * Reject disagreement instead of choosing a convenient quantization grid. */
export function parseSymbolicPair(csv: string, lisp: string, columns: number): PairedRows {
  const lines = (text: string) => text.trim().split(/\r?\n/).filter(line => line.trim());
  const values = lines(csv).map(line => line.split(',').map(value => Number(value.trim())));
  const rational = lines(lisp).map(line => {
    if (!/^\s*\([^()]+\)\s*$/.test(line)) throw new Error('Expected one flat Lisp row per line.');
    return line.trim().slice(1, -1).trim().split(/\s+/).map(token => {
      if (!/^-?\d+(?:\/\d+)?$/.test(token)) throw new Error(`Unsupported rational token: ${token}`);
      const [numerator, denominator = 1] = token.split('/').map(Number);
      if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) || denominator <= 0) throw new Error('Invalid exact rational.');
      const divisor = gcd(numerator, denominator);
      return { numerator: numerator / divisor, denominator: denominator / divisor };
    });
  });
  if (!values.length || values.length !== rational.length) throw new Error('CSV/Lisp row counts disagree.');
  let roundedTimeValues = 0, maximumTimeRounding = 0;
  values.forEach((row, i) => {
    if (row.length !== columns || rational[i].length !== columns) throw new Error('Unexpected symbolic column count.');
    row.forEach((value, j) => {
      const exact = rational[i][j].numerator / rational[i][j].denominator;
      const error = Math.abs(value - exact), time = j === 0 || columns === 5 && j === 3;
      // CSV has rounded floating-point tuplets despite ten printed decimals.
      // Permit one float32 relative epsilon; exact Lisp remains authoritative.
      const tolerance = time ? Math.max(1e-9, Math.abs(exact) * 2 ** -23) : 0;
      if (!Number.isFinite(value) || error > tolerance) throw new Error(`CSV/Lisp values disagree at row ${i + 1}, column ${j + 1}: ${value} versus ${exact}.`);
      if (time && error) { roundedTimeValues++; maximumTimeRounding = Math.max(maximumTimeRounding, error); }
    });
  });
  return { values, rational, roundedTimeValues, maximumTimeRounding };
}

export function loadBenchmarkWork(work: string, definition = benchmarkDefinition()): BenchmarkWork {
  const registered = definition.works.find(entry => entry.id === work);
  if (!registered) throw new Error(`Unknown benchmark work: ${work}`);
  const csvPath = registered.asset.path, lispPath = registered.exactSourcePath;
  const csv = readFileSync(csvPath, 'utf8'), lisp = readFileSync(lispPath, 'utf8');
  if (hash(csv) !== registered.asset.sha256) throw new Error('Canonical CSV hash differs from the corpus registry.');
  const paired = parseSymbolicPair(csv, lisp, 5);
  const ppq = paired.rational.reduce((base, row) => lcm(lcm(base, row[0].denominator), row[3].denominator), 1);
  const ticks = (value: Rational) => {
    const result = value.numerator * (ppq / value.denominator);
    if (!Number.isSafeInteger(result)) throw new Error('Annotation time is not on the exact source grid.');
    return result;
  };
  const pickupShiftTicks = Math.max(0, -Math.min(...paired.rational.map(row => ticks(row[0]))));
  const staffs = [...new Set(paired.values.map(row => row[4]))].sort((a, b) => a - b);
  if (staffs.some(staff => !Number.isSafeInteger(staff) || staff < 0)) throw new Error('Invalid staff identifier.');
  const notes: ScoreNote[] = paired.rational.map((row, i) => {
    const midi = paired.values[i][1];
    if (!Number.isSafeInteger(midi)) throw new Error('Expected integer MIDI pitch.');
    return { id: `row-${i}`, part: `staff-${paired.values[i][4]}`, onset: ticks(row[0]) + pickupShiftTicks,
      duration: ticks(row[3]), pitch: { millicents: midi * 100000 }, velocity: 80, releaseVelocity: 64 };
  });
  const duration = Math.max(...notes.map(note => note.onset + note.duration));
  const score: Score = { ppq, duration, notes, attachments: [], trackEnds: staffs.map(() => duration),
    parts: staffs.map((staff, i) => ({ id: `staff-${staff}`, name: `Staff ${staff}`, track: i, channel: i % 16, percussion: false })) };
  validateScore(score);
  const key = (note: ScoreNote) => `${note.onset}:${note.pitch.millicents / 100000}`;
  const points = new Map<string, ScoreNote[]>();
  for (const note of notes) { const group = points.get(key(note)) ?? []; group.push(note); points.set(key(note), group); }
  const families: Family[] = [];
  for (const annotator of definition.annotationDirectories) {
    const parent = join(registered.annotationPath, annotator);
    if (!existsSync(parent)) continue;
    for (const family of readdirSync(parent, { withFileTypes: true }).filter(entry => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
      const occurrences: Occurrence[] = [], occurrenceRoot = join(parent, family.name, 'occurrences');
      for (const filename of readdirSync(join(occurrenceRoot, 'csv')).filter(name => /^occ\d+\.csv$/.test(name)).sort((a, b) => Number(a.slice(3, -4)) - Number(b.slice(3, -4)))) {
        const rows = parseSymbolicPair(readFileSync(join(occurrenceRoot, 'csv', filename), 'utf8'),
          readFileSync(join(occurrenceRoot, 'lisp', basename(filename, '.csv') + '.txt'), 'utf8'), 2);
        const raw = rows.rational.map(row => `${ticks(row[0]) + pickupShiftTicks}:${row[1].numerator / row[1].denominator}`);
        if (raw.some(point => !points.has(point))) throw new Error(`${annotator}/${family.name}/${filename}: annotation point absent from source.`);
        const members = [...new Set(raw)];
        occurrences.push({ id: basename(filename, '.csv'), members, duplicatePoints: raw.length - members.length });
      }
      if (!occurrences.length || occurrences[0].id !== 'occ1') throw new Error('Annotated query occurrence missing.');
      families.push({ id: `${annotator}/${family.name}`, annotator, occurrences });
    }
  }
  return { work, score, families, points, pickupShiftTicks,
    source: { csvPath, csvSha256: hash(csv), lispPath, lispSha256: hash(lisp) },
    statistics: { sourceRows: notes.length, coincidentPointCollisions: notes.length - points.size, families: families.length,
      roundedCsvTimeValues: paired.roundedTimeValues, maximumCsvTimeRoundingQuarters: paired.maximumTimeRounding,
      occurrences: families.reduce((sum, family) => sum + family.occurrences.length, 0) } };
}


/** Analysis receives source notes only; annotations enter this evaluator afterwards. */
export function evaluateSceneWork(work: BenchmarkWork) {
  const saved = structuredClone(work.score), started = performance.now();
  const scene = callCoreSync('encodeScore', {score:work.score});
  assert.deepEqual(callCoreSync('decodeScene', {scene}), saved);
  assert.deepEqual(work.score, saved);
  const nodes = new Map(scene.nodes.map(node => [node.id, node]));
  const notes = new Map(work.score.notes.map(note => [note.id, note]));
  const candidates: DiscoveryMembership[] = scene.nodes.filter(node => node.kind === 'rhythm').map(rhythm => ({
    id:rhythm.id, occurrences:rhythm.children.map(id => {
      const node = nodes.get(id);
      if (!node) throw new Error('Rhythm material references missing occurrence.');
      return {id, members:[...new Set(node.noteIds.map(id => {
        const note = notes.get(id); if (!note) throw new Error('Scene references missing note.');
        return String(note.onset) + ':' + String(note.pitch.millicents / 100000);
      }))]};
    })}));
  return {work:work.work, source:work.source, ...work.statistics, sourceUnchanged:true, exactReconstruction:true,
    elapsedMs:performance.now()-started, costs:scene.costs, issues:scene.issues,
    candidates:candidates.map(candidate=>({id:candidate.id,occurrences:candidate.occurrences.length})),
    evaluation:evaluateDiscoveredMemberships(candidates,work.families)};
}

async function main() {
  const args=process.argv.slice(2), option=(name:string)=>args.find(arg=>arg.startsWith('--'+name+'='))?.slice(name.length+3);
  if (args.includes('--holdout')) throw new Error('Scene development does not expose held-out works.');
  const definition=benchmarkDefinition(), requested=option('work');
  const allowed=definition.works.filter(work=>work.split==='development').map(work=>work.id);
  if(requested && !allowed.includes(requested))throw new Error('Requested work is outside the development split.');
  const files=[...coreMethodFiles(),'scripts/core-source.ts','scripts/evaluate-patterns.ts'];
  const methodSha256=hash(files.map(path=>path+':'+hash(readFileSync(path))).join('\n'));
  const results=(requested?[requested]:allowed).map(work=>evaluateSceneWork(loadBenchmarkWork(work,definition)));
  console.log(writeAuditJson(option('out')??'.audit/scene-evaluation.json',{methodSha256,split:'development',
    interpretation:'Executable material reuse versus independent annotated pattern families. Posthoc best-family selection is oracle adequacy, not perceptual theme accuracy. Coincident notes collapse to annotation onset/pitch points.',results}));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
