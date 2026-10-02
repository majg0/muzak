import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadCore, type CoreRequest } from '../src/core/runtime';
import type { Score } from '../src/score/score';

const runtime = await loadCore();
const executable = resolve('target/debug', process.platform === 'win32' ? 'muzak-core.exe' : 'muzak-core');
function parity(requests: CoreRequest[]) {
  assert.ok(existsSync(executable), 'Build the native and Wasm core with node scripts/build-core.mjs before parity checks.');
  const saved = structuredClone(requests);
  const native = execFileSync(executable, [], {input: requests.map(request => JSON.stringify(request)).join('\n') + '\n', encoding: 'utf8', maxBuffer: 10 * 1024 * 1024})
    .trim().split(/\r?\n/).map(line => JSON.parse(line));
  const wasm = requests.map(request => {
    try { return {response: runtime.call(request)}; }
    catch (error) { return {error: {code: (error as {code: string}).code, message: (error as Error).message}}; }
  });
  assert.deepEqual(wasm, native, 'The same Rust request produces identical native and Wasm evidence.');
  assert.deepEqual(requests, saved);
  return native;
}
function fixture(): Score {
  const notes: Score['notes'] = [];
  for (let occurrence = 0; occurrence < 3; occurrence++) for (let i = 0; i < 2; i++) {
    const pitch = -12500 + i * 137500 + occurrence * 237500;
    notes.push({id: `${occurrence}/${i}`, part: 'a', onset: occurrence * 12 + i * 3, duration: 4, pitch: {millicents: pitch},
      velocity: 70 + occurrence, releaseVelocity: 60,
      pitchEnvelope: [{tick: 0, pitch: {millicents: pitch}}, {tick: 3, pitch: {millicents: pitch + 12500}}],
      gainEnvelope: [{tick: 0, gain: .25}, {tick: 4, gain: .75}]});
  }
  return {ppq: 12, duration: 36, parts: [{id: 'a', name: 'Native line', track: 0, channel: 0, percussion: false}],
    notes, trackEnds: [36], attachments: [{tick: 0, track: 0, order: 0, bytes: [255, 81, 3, 7, 161, 32]}]};
}


test('native and Wasm share exact scene encoding, standalone decoding and local interventions', () => {
  const score=fixture();
  const scene=parity([{op:'encodeScore',input:{score}}])[0].response.output;
  const decoded=parity([{op:'decodeScene',input:{scene:JSON.parse(JSON.stringify(scene))}}])[0].response.output;
  assert.deepEqual(decoded,score);
  const owner=scene.nodes.find((node:{placementPath?:string})=>node.placementPath!==undefined);
  assert.ok(owner);
  const changed=parity([{op:'transposeScene',input:{scene,scope:'occurrence',target:owner.placementPath,millicents:31250}}])[0].response.output as Score;
  const members=new Set(owner.noteIds);
  for(const note of changed.notes) {
    const original=score.notes.find(source=>source.id===note.id)!;
    assert.equal(note.pitch.millicents-original.pitch.millicents,members.has(note.id)?31250:0);
    assert.equal(note.pitchEnvelope![1].pitch.millicents-original.pitchEnvelope![1].pitch.millicents,members.has(note.id)?31250:0);
  }
});

test('native and Wasm reject unsafe coordinates and malformed codec ownership', () => {
  const score=fixture(), malformed=structuredClone(score);
  malformed.notes[0].pitch.millicents=Number.MAX_SAFE_INTEGER+1;
  const scene=parity([{op:'encodeScore',input:{score}}])[0].response.output;
  scene.identities.push({...scene.identities[0]});
  const replies=parity([{op:'validateScore',input:{score:malformed}},{op:'decodeScene',input:{scene}}]);
  assert.ok(replies.every(reply=>reply.error?.code==='invalid-input'));
});

test('misspelled operation inputs cannot silently run with default analysis settings',()=>{
  const requests=[
    {op:'inferGlobalHarmony',input:{score:fixture(),parameters:{boundaryCost:0}}},
    {op:'inferGlobalHarmony',input:{score:fixture(),options:{boundaryCosts:0}}},
  ] as unknown as CoreRequest[];
  for(const reply of parity(requests)) {
    assert.equal(reply.error?.code,'invalid-input');
    assert.match(reply.error.message,/unknown field/);
  }
});
