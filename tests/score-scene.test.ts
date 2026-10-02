import test from 'node:test';
import assert from 'node:assert/strict';
import { callCoreSync as call } from '../src/core/sync';
import type { Score, ScoreNote } from '../src/score/score';
import { exportScoreMidi } from '../src/score/midi-score';

const note=(id:string,part:string,onset:number,pitch:number,velocity=80):ScoreNote=>({id,part,onset,duration:2,pitch:{millicents:pitch},velocity,releaseVelocity:31});
const options={support:{minOccurrences:100},partition:{features:{time:1,pitch:0,velocity:0,duration:0,rhythm:0,support:0,supportMembership:0},noteWeights:{velocity:0,duration:0,rhythm:0,support:0,supportMembership:0},boundaryWeight:0,gapWeight:0,minGain:.01,maxDepth:1,minLeafNotes:1}};
function fixture():Score {
  return {ppq:12,duration:48,trackEnds:[48,40],parts:[{id:'a',name:'Line',track:0,channel:0,percussion:false},{id:'b',name:'Parallel',track:1,channel:1,percussion:false}],
    notes:[...['a','b'].flatMap((part,p)=>[0,24].flatMap((start,occ)=>[0,3,7].map((offset,i)=>note(`${part}-${start}-${i}`,part,start+offset,6000000+[0,400000,12501][i]+p*700000+occ*200000,80+occ*7)))),note('terminal','a',48,7200000)],
    attachments:[{tick:0,track:0,order:0,bytes:[255,88,4,7,2,24,8]},{tick:13,track:0,order:1,bytes:[255,88,4,5,2,24,8]},{tick:0,track:1,order:0,bytes:[177,11,89]}]};
}

test('scene decodes standalone with exact identity, native curves, context, silent track ends and zero-duration events',()=>{
  const source=fixture();source.notes.at(-1)!.duration=0;
  source.notes[0].pitchEnvelope=[{tick:0,pitch:{millicents:6000000}},{tick:1,pitch:{millicents:6001123}}];
  source.notes[0].gainEnvelope=[{tick:0,gain:.3},{tick:2,gain:.9}];
  source.notes.reverse();const saved=structuredClone(source);
  const scene=call('encodeScore',{score:source,options});
  assert.deepEqual(scene.verification,{exactNotes:true,exactContext:true,exactIdentities:true});
  const serialized=JSON.parse(JSON.stringify(scene));
  assert.deepEqual(call('decodeScene',{scene:serialized}),source);
  assert.deepEqual(source,saved);
  assert.equal(scene.identities.length,source.notes.length);
  assert.equal(new Set(scene.identities.map(x=>x.emittedId)).size,source.notes.length);
  assert(scene.costs.materialNoteCount>0);
  assert(scene.limitations.some(text=>text.includes('not established phrases')),'No partition is promoted into an unsupported phrase label.');
});

test('instantaneous endpoint materials cover ordinary and maximum safe endings without inventing silence',()=>{
  for(const end of [0,100,Number.MAX_SAFE_INTEGER]){
    const source:Score={ppq:1,duration:end,trackEnds:[end],parts:[{id:'a',name:'',track:0,channel:0,percussion:false}],attachments:[],notes:[{...note('end','a',end,6000000),duration:0}]};
    if(end>0)source.notes.unshift({...note('first','a',0,6400000),duration:1});
    for(const partition of [undefined,{maxSplitEvaluations:0}]){
      const scene=call('encodeScore',{score:source,options:{partition}});
      assert(scene.program.materials.some(m=>m.span===0));
      assert.deepEqual(call('decodeScene',{scene}),source);
    }
  }
});

test('rational program edits refine context silence and metadata along with note time',()=>{
  const source=fixture();source.notes.pop();
  const scene=call('encodeScore',{score:source,options});
  scene.program.placements[0].timeScale={numerator:1,denominator:3};
  const decoded=call('decodeScene',{scene});
  assert.equal(decoded.ppq,source.ppq*3);
  assert.equal(decoded.duration/source.ppq/3,source.duration/source.ppq);
  assert.equal(decoded.attachments[1].tick,source.attachments[1].tick*3);
  assert.equal(decoded.trackEnds[1],source.trackEnds[1]*3);
});

test('coincident native curves canonicalize before their independently varying dynamics',()=>{
  const source:Score={ppq:1,duration:24,trackEnds:[24],parts:[{id:'a',name:'',track:0,channel:0,percussion:false}],attachments:[],notes:[]};
  for(const onset of [0,12])for(const [i,gain]of[.2,.8].entries())source.notes.push({...note(`${onset}-${i}`,'a',onset,6000000,onset===0?60+i*20:80-i*20),gainEnvelope:[{tick:0,gain},{tick:2,gain:1-gain}]});
  const scene=call('encodeScore',{score:source,options});
  assert(scene.nodes.some(n=>n.kind==='rhythm'&&n.noteIds.length===4));
  assert.equal(scene.costs.materialNoteCount,2);
  assert.deepEqual(call('decodeScene',{scene}),source);
});

test('analytical membership, cycles, and excessive external edit paths are rejected explicitly',()=>{
  const source=fixture();source.notes.pop();const scene=call('encodeScore',{score:source,options});
  const wrong=structuredClone(scene);wrong.nodes[0].noteIds.push('unknown');
  assert.throws(()=>call('decodeScene',{scene:wrong}),/membership/);
  const cycle=structuredClone(scene),root=cycle.nodes.find(n=>n.id===cycle.roots[0])!;
  root.parentIds.push(root.id);root.children.push(root.id);cycle.roots=cycle.roots.filter(id=>id!==root.id);cycle.regions.find(r=>r.id===root.id)!.parentIds=root.parentIds;
  assert.throws(()=>call('decodeScene',{scene:cycle}),/cycle/);
  assert.throws(()=>call('transposeScene',{scene,scope:'occurrence',target:Array(1000).fill('0').join('.'),millicents:1}),/budget/);
});

test('native-curve canonical order is invariant across pitch digit boundaries, while percussion key translations stay distinct',()=>{
  const source:Score={ppq:1,duration:24,trackEnds:[24],parts:[{id:'a',name:'',track:0,channel:0,percussion:false}],attachments:[],notes:[]};
  for(const onset of [0,12])for(const [i,peak]of[950000,1050000].entries()){
    const shift=onset===0?0:100000;source.notes.push({...note(`${onset}-${i}`,'a',onset,900000+shift),pitchEnvelope:[{tick:0,pitch:{millicents:900000+shift}},{tick:2,pitch:{millicents:peak+shift}}]});
  }
  const scene=call('encodeScore',{score:source,options});assert.equal(scene.costs.materialCount,1);
  assert.deepEqual(call('decodeScene',{scene}),source);
  const drums=structuredClone(source);drums.parts[0].percussion=true;drums.parts[0].channel=9;
  assert.equal(call('encodeScore',{score:drums,options}).costs.materialCount,2);
});

test('a translated content dictionary drives genuinely shared and occurrence-local edits with explicit velocity residuals',()=>{
  const source=fixture();source.notes.pop();const scene=call('encodeScore',{score:source,options});
  const theme=scene.nodes.find(n=>n.kind==='rhythm');assert(theme?.materialId);
  assert(theme.children.length>=2);assert(scene.velocityResiduals.length>0);
  const owner=scene.nodes.find(n=>n.id===theme.children[0])!;assert(owner.placementPath);
  const local=call('transposeScene',{scene,scope:'occurrence',target:owner.placementPath,millicents:37});
  const shared=call('transposeScene',{scene,scope:'material',target:theme.materialId,millicents:37});
  const changed=(score:Score)=>score.notes.filter((n,i)=>n.pitch.millicents!==source.notes[i].pitch.millicents).map(n=>n.id).sort();
  assert.deepEqual(changed(local),[...owner.noteIds].sort());
  assert.deepEqual(changed(shared),[...theme.noteIds].sort());
  const edited=structuredClone(scene),material=edited.program.materials.find(m=>m.id===theme.materialId)!;
  for(const n of material.notes)n.pitch.millicents+=37;
  assert.deepEqual(call('transposeScene',{scene:edited,scope:'material',target:theme.materialId,millicents:-37}),source);
  assert.deepEqual(call('decodeScene',{scene}),source);
});

test('note-feature priors alter proposed hierarchy without changing decoded polyphonic observations',()=>{
  const source=fixture();source.notes.pop();
  const temporal=call('encodeScore',{score:source,options});
  const register=call('encodeScore',{score:source,options:{...options,partition:{...options.partition,features:{...options.partition.features,time:0,pitch:1}}}});
  const groups=(scene:typeof temporal)=>scene.nodes.filter(n=>n.kind==='partition').map(n=>[...n.noteIds].sort());
  assert.notDeepEqual(groups(temporal),groups(register));
  assert.deepEqual(call('decodeScene',{scene:temporal}),source);
  assert.deepEqual(call('decodeScene',{scene:register}),source);
});

test('co-release support and complement observations may overlap a partition while each source event has one emitting owner',()=>{
  const source:Score={ppq:2,duration:48,trackEnds:[48],parts:[{id:'p',name:'',track:0,channel:0,percussion:false}],attachments:[],notes:[]};
  for(let c=0;c<6;c++){
    const start=c*8;
    for(const [i,pitch]of[4300000,5000000,5500000].entries())source.notes.push({...note(`${c}s${i}`,'p',start+i,pitch),duration:8-i});
    source.notes.push(note(`${c}m`,'p',start+5,6000000+c%2*100000));
  }
  const scene=call('encodeScore',{score:source});
  assert(scene.nodes.some(n=>n.kind==='arpeggio'));
  assert(scene.nodes.some(n=>n.kind==='melody'));
  assert(scene.nodes.filter(n=>n.noteIds.includes('0s0')).length>2);
  assert.equal(scene.identities.length,source.notes.length);
  assert.deepEqual(call('decodeScene',{scene}),source);
  assert.deepEqual(exportScoreMidi(call('decodeScene',{scene})),exportScoreMidi(source));
  const partition={...options.partition,maxDepth:3,supportCohesionWeight:0,melodyCohesionWeight:0};
  const time=call('encodeScore',{score:source,options:{partition}});
  const pitch=call('encodeScore',{score:source,options:{partition:{...partition,features:{...partition.features,time:0,pitch:1}}}});
  const ownership=(x:typeof scene)=>x.nodes.filter(n=>n.kind==='arpeggio'&&n.placementPath).map(n=>[n.noteIds,n.placementPath]);
  assert.deepEqual(ownership(time),ownership(pitch),'Spatial containers do not dictate independent executable support ownership.');
  for(const x of [time,pitch]){
    for(const n of x.nodes.filter(n=>n.kind==='arpeggio'&&n.placementPath))assert(!n.parentIds.some(id=>x.nodes.find(p=>p.id===id)?.kind==='partition'));
    assert(x.program.definitions!.every(d=>d.placements.length>0),'No empty executable definitions remain.');
    assert.deepEqual(call('decodeScene',{scene:x}),source);
  }
});

test('malformed decoder ownership and bounded unavailable analysis do not silently lose events',()=>{
  const source=fixture();source.notes.pop();
  const scene=call('encodeScore',{score:source,options:{...options,partition:{maxSplitEvaluations:0}}});
  assert(scene.issues.some(x=>x.stage==='weighted partition'));
  assert.deepEqual(call('decodeScene',{scene}),source);
  const invalid=structuredClone(scene);invalid.identities.push(invalid.identities[0]);
  assert.throws(()=>call('decodeScene',{scene:invalid}),/ownership/);
  assert.throws(()=>call('encodeScore',{score:source,options:{maxNotes:1}}),/budget/);
  assert.throws(()=>call('encodeScore',{score:source,options:{maxRegionMembers:1}}),/budget/);
});
