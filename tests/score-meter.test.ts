import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { callCoreSync } from '../src/core/sync';
import type { Score } from '../src/score/score';

function score(ppq:number,duration:number,changes:number[][]):Score {
  return {ppq,duration,parts:[],notes:[],trackEnds:[duration],attachments:changes.map(([tick,numerator,exponent,clocks=24,bb=8],order)=>({tick,track:0,order,bytes:[255,88,4,numerator,exponent,clocks,bb]}))};
}
test('3/4 and 6/8 share bar duration but expose different denominator beats without modifying metadata',()=>{
  const simple=score(4,24,[[0,3,2]]),compound=score(4,24,[[0,6,3,36]]),before=structuredClone(compound);
  const a=callCoreSync('scoreMeter',{score:simple}),b=callCoreSync('scoreMeter',{score:compound});
  assert.deepEqual(a.markers.filter(m=>m.kind==='bar').map(m=>m.tick),[0,12,24]);
  assert.deepEqual(b.markers.filter(m=>m.kind==='bar').map(m=>m.tick),[0,12,24]);
  assert.deepEqual(a.markers.slice(0,3).map(m=>m.label),['1:1','1:2','1:3']);
  assert.deepEqual(b.markers.slice(0,6).map(m=>m.label),['1:1','1:2','1:3','1:4','1:5','1:6']);
  assert.equal(b.markers[1].tick,2);assert.deepEqual(compound,before);
  assert.ok(b.diagnostics.some(d=>d.includes('pickup')));
});
test('meter changes retain accumulated bar numbering while repeated declarations retain phase',()=>{
  const result=callCoreSync('scoreMeter',{score:score(48,480,[[0,6,3,36],[100,6,3,36],[288,4,2]])});
  assert.equal(result.segments.length,2);
  assert.deepEqual(result.segments.map(s=>[s.startTick,s.numerator,s.denominator,s.firstBar]),[[0,6,8,'1'],[288,4,4,'3']]);
  assert.equal(result.markers.find(m=>m.tick===288)?.label,'3:1');
  assert.equal(result.markers.find(m=>m.tick===336)?.label,'3:2');
});
test('unknown and conflicting meter stays unknown, including transitions between quarter coordinates',()=>{
  const missing=callCoreSync('scoreMeter',{score:score(4,12,[])});
  assert.deepEqual(missing.markers.map(m=>m.label),['q0','q1','q2','q3']);
  const result=callCoreSync('scoreMeter',{score:score(4,20,[[0,4,2],[5,3,2],[5,6,3]])});
  assert.equal(result.segments[1].source,'conflict');
  assert.equal(result.markers.find(m=>m.tick===5)?.label,'q5/4');
  assert.ok(result.markers.filter(m=>m.tick>=5).every(m=>m.bar===null));
  const clickConflict=callCoreSync('scoreMeter',{score:score(4,12,[[0,3,2,24],[0,3,2,36]])});
  assert.equal(clickConflict.segments[0].source,'metadata');
  assert.equal(clickConflict.segments[0].clocksPerClick,null);
  assert.equal(clickConflict.segments[0].numerator,3);
});
test('marker budgets fail explicitly and a bounded range preserves global position',()=>{
  const source=score(4,80,[[0,4,2]]);
  assert.throws(()=>callCoreSync('scoreMeter',{score:source,options:{maxMarkers:2}}),/budget/);
  const range=callCoreSync('scoreMeter',{score:source,options:{fromTick:32,toTick:39,maxMarkers:2}});
  assert.deepEqual(range.markers.map(m=>[m.tick,m.label]),[[32,'3:1'],[36,'3:2']]);
  assert.throws(()=>callCoreSync('scoreMeter',{score:source,options:{fromTick:81}}),/range/);
});
test('native and Wasm meter geometry agree exactly for fractional beats and unusual notated-quarter scaling',()=>{
  const request={op:'scoreMeter' as const,input:{score:score(3,6,[[0,3,3,24,16]])}};
  const executable=resolve('target/debug',process.platform==='win32'?'muzak-core.exe':'muzak-core');
  const reply=JSON.parse(execFileSync(executable,[],{input:JSON.stringify(request)+'\n',encoding:'utf8'}));
  const output=callCoreSync('scoreMeter',request.input);
  assert.deepEqual(reply.response.output,output);
  assert.deepEqual(output.markers[1].exactTick,{numerator:'3',denominator:'4'});
  assert.equal(output.markers[1].tick,.75);
});
