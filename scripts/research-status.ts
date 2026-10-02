import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

interface Task { id: string; title: string; status: 'planned' | 'in_progress' | 'done' | 'blocked'; owner: string | null; dependsOn: string[]; evidence: string[]; nextAction: string; }
interface Asset { path: string; sha256: string }
function registeredAssets(value: unknown): Asset[] {
  if (!value || typeof value !== 'object') return [];
  const item = value as Record<string, unknown>;
  if (typeof item.path === 'string' && typeof item.sha256 === 'string') return [item as unknown as Asset];
  return Object.values(item).flatMap(registeredAssets);
}
const program = JSON.parse(readFileSync('docs/research/program.json', 'utf8')) as {
  schemaVersion: number; updatedDate: string; checkpoint: { summary: string; nextActions: string[] }; tasks: Task[];
};
assert.equal(program.schemaVersion, 1);
const byId = new Map(program.tasks.map(task => [task.id, task]));
assert.equal(byId.size, program.tasks.length, 'Task IDs must be unique.');
const visiting = new Set<string>(), visited = new Set<string>();
const visit = (id: string) => {
  assert(!visiting.has(id), `Dependency cycle at ${id}`);
  if (visited.has(id)) return;
  const task = byId.get(id);
  assert(task, `Missing dependency ${id}`);
  assert(['planned', 'in_progress', 'done', 'blocked'].includes(task.status), `Invalid state: ${id}`);
  assert(task.nextAction, `Missing next action: ${id}`);
  visiting.add(id);
  task.dependsOn.forEach(visit);
  visiting.delete(id); visited.add(id);
};
program.tasks.forEach(task => visit(task.id));
const unavailable: string[] = [];
const corpus = JSON.parse(readFileSync('docs/research/corpus-candidates.json', 'utf8')) as {
  preferences: string[];
  analysisCandidates: Array<{ id: string; asset?: { path: string; sha256: string } }>;
  evaluationSources?: Array<{ id: string; root: string; retainedFiles: { count: number; sha256: string };
    split?: { development: string[]; holdout: string[] };
    works?: Array<{ id: string; split: string; exactSourcePath?: string }> }>;
};
assert.equal(new Set(corpus.analysisCandidates.map(candidate => candidate.id)).size, corpus.analysisCandidates.length, 'Analysis source IDs must be unique.');
for (const candidate of corpus.analysisCandidates) {
  if (candidate.asset) {
    if (existsSync(candidate.asset.path)) assert.equal(createHash('sha256').update(readFileSync(candidate.asset.path)).digest('hex'), candidate.asset.sha256.toLowerCase(), `Asset hash mismatch: ${candidate.id}`);
    else unavailable.push(`${candidate.id}: local asset missing: ${candidate.asset.path}`);
  }
}
// Integrity checks may hash held-out bytes, but never parse their notes/labels.
for (const dataset of corpus.evaluationSources ?? []) {
  if (!existsSync(dataset.root)) { unavailable.push(`${dataset.id}: benchmark root missing: ${dataset.root}`); continue; }
  const works = dataset.works ?? [];
  assert.equal(new Set(works.map(work => work.id)).size, works.length, `Duplicate work in ${dataset.id}`);
  if (dataset.split) {
    const families = [...dataset.split.development, ...dataset.split.holdout];
    assert.equal(new Set(families).size, families.length, `Overlapping tune-family splits in ${dataset.id}`);
  }
  for (const work of works) {
    assert(['development', 'validation', 'holdout'].includes(work.split), `Unknown evaluation split: ${work.id}`);
    if (work.exactSourcePath) assert(existsSync(work.exactSourcePath), `Missing exact symbolic data: ${work.id}`);
    assert(registeredAssets(work).length, `No registered evidence for ${work.id}`);
  }
  for (const asset of registeredAssets(dataset)) {
    assert.equal(createHash('sha256').update(readFileSync(asset.path)).digest('hex'), asset.sha256.toLowerCase(), `Benchmark hash mismatch: ${asset.path}`);
  }
  const root = resolve(dataset.root), files: string[] = [];
  const collect = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      assert(!entry.isSymbolicLink(), `Unexpected benchmark symlink: ${entry.name}`);
      const path = join(directory, entry.name);
      if (entry.isDirectory()) collect(path);
      else if (entry.isFile()) files.push(relative(root, path).replaceAll('\\', '/'));
    }
  };
  collect(root); files.sort();
  assert.equal(files.length, dataset.retainedFiles.count, `Benchmark file count differs: ${dataset.id}`);
  const manifest = files.map(path => `${path}:${createHash('sha256').update(readFileSync(join(root, path))).digest('hex')}\n`).join('');
  assert.equal(createHash('sha256').update(manifest).digest('hex'), dataset.retainedFiles.sha256, `Benchmark manifest differs: ${dataset.id}`);
}
for (const task of program.tasks) {
  if (task.status === 'done') {
    assert(task.evidence.length, `Completed task lacks evidence: ${task.id}`);
    assert(task.dependsOn.every(id => byId.get(id)!.status === 'done'), `Completed task has unfinished dependency: ${task.id}`);
  }
  for (const path of task.evidence) {
    if (!existsSync(path)) {
      if (path.startsWith('research/corpus/') || path.startsWith('.audit/')) unavailable.push(`${task.id}: local asset missing: ${path}`);
      else throw new Error(`${task.id}: missing versioned evidence: ${path}`);
    }
  }
}
console.log(`Research checkpoint ${program.updatedDate}: ${program.tasks.length} tasks; dependency graph valid.`);
console.log(`Corpus: ${corpus.analysisCandidates.length} active analysis sources; available asset hashes verified.`);
for (const dataset of corpus.evaluationSources ?? []) {
  const development = dataset.split?.development.length ?? dataset.works!.filter(work => work.split === 'development').length;
  const holdout = dataset.split?.holdout.length ?? dataset.works!.filter(work => work.split === 'holdout').length;
  console.log(`Evaluation: ${dataset.id}; ${development} development / ${holdout} held-out ${dataset.split ? 'tune families' : 'works'}. Integrity only; held-out content is not parsed.`);
}
console.log(program.checkpoint.summary);
console.log('\nNext actions:');
program.checkpoint.nextActions.forEach(action => console.log(`- ${action}`));
console.log('\nReady or active tasks:');
program.tasks.filter(task => task.status !== 'done' && task.dependsOn.every(id => byId.get(id)!.status === 'done'))
  .forEach(task => console.log(`${task.id} [${task.status}] ${task.title}\n  ${task.nextAction}`));
if (unavailable.length) console.log('\nReacquisition needed:\n' + unavailable.join('\n'));
