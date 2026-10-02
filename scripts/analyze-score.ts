import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { callCoreSync } from '../src/core/sync';
import { importMidi, exportScoreMidi } from '../src/score/midi-score';
import { readMidi } from '../src/score/midi-file';
import { writeAuditJson } from './audit-output';

const args = process.argv.slice(2);
const option = (name: string) => args.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const corpusMode = args.includes('--corpus');
const started = performance.now();
function analyze(path: string) {
  const bytes = readFileSync(path), { score, issues } = importMidi(bytes);
  const encodeStarted = performance.now();
  const scene = callCoreSync('encodeScore', {score});
  const encodeMilliseconds = performance.now() - encodeStarted;
  const decoded = callCoreSync('decodeScene', {scene});
  assert.deepEqual(decoded, score, `${path}: standalone scene changed score evidence.`);
  assert.deepEqual(readMidi(exportScoreMidi(decoded)), readMidi(bytes), `${path}: decoded MIDI events changed.`);
  return {path, sha256:createHash('sha256').update(bytes).digest('hex'), notes:score.notes.length,
    exactScoreRoundtrip:true, exactEventRoundtrip:true, issues, sceneIssues:scene.issues, encodeMilliseconds,
    harmonicWindows:scene.harmony?.windows.length ?? null,
    unresolvedHarmonicWindows:scene.harmony?.windows.filter(w=>!w.rest&&w.selected===null).length ?? null,
    nodes:scene.nodes.length, materials:scene.program.materials.length,
    automaticPitchRelations: {
      status:scene.issues.some(issue => issue.stage === 'pitch relations') ? 'unavailable' : 'complete-within-declared-scope',
      candidateCount:scene.pitchRelations.length,
      selectedCount:scene.pitchRelations.filter(relation => relation.selected).length,
      domainPremise: {
        source:'ordered observed nonpercussion positive-duration attack residues',
        periodMillicents:scene.parameters.pitchPeriodMillicents,
        maxClasses:scene.parameters.maxPitchClasses,
        interpretation:'Observed vocabulary only; no inferred key, spelling or unobserved scale degrees.',
      },
      parameters:scene.parameters.relations,
      retainedExecutableLattices:scene.program.pitchLattices ?? [],
    },
    sceneCosts:scene.costs,
    sourceJsonBytes:Buffer.byteLength(JSON.stringify(score)), sceneJsonBytes:Buffer.byteLength(JSON.stringify(scene)),
    ...(corpusMode ? {} : {scene})};
}
let report: unknown;
if (corpusMode) {
  const registry = JSON.parse(readFileSync('docs/research/corpus-candidates.json', 'utf8')) as {
    analysisCandidates: Array<{id:string; asset:{path:string; sha256:string}}> };
  report = registry.analysisCandidates.map(candidate => {
    if (!existsSync(candidate.asset.path)) return {id:candidate.id, missing:candidate.asset.path};
    const result = analyze(candidate.asset.path);
    assert.equal(result.sha256, candidate.asset.sha256);
    console.log(`${candidate.id}: ${result.notes} notes; ${result.automaticPitchRelations.selectedCount}/${result.automaticPitchRelations.candidateCount} pitch relations selected; ${Math.round(result.encodeMilliseconds)} ms encode; exact scene and MIDI reconstruction`);
    return {id:candidate.id, ...result};
  });
} else {
  const path = args.find(arg => !arg.startsWith('--'));
  if (!path) throw new Error('Usage: npm run analyze -- INPUT.mid [--out=PATH], or --corpus.');
  report = analyze(path);
}
console.log(writeAuditJson(option('out') ?? '.audit/codec.json', report));
console.log(`${Math.round(performance.now() - started)} ms. Reconstruction correctness is separate from musical interpretation.`);
