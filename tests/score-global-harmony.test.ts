import test from 'node:test';
import assert from 'node:assert/strict';
import {callCoreSync as call} from '../src/core/sync';
import type {Score} from '../src/score/score';

function score():Score {
  const parts=['bass','third','fifth','color'].map((id,track)=>({id,name:id,track,channel:track,percussion:false}));
  const notes:Score['notes']=[];
  for(const [section,[onset,duration,pitches]] of ([
    [0,48,[48,64,67,74]], [48,24,[53,68,72,79]], [72,24,[55,71,74,81]],
  ] as const).entries()) for(const [part,pitch] of pitches.entries()) notes.push({
    id:`${section}-${part}`,part:parts[part].id,onset:onset+(part===3?12:0),duration:part===3?6:duration,
    pitch:{millicents:pitch*100000},velocity:80,releaseVelocity:64,
  });
  return {ppq:12,duration:96,parts,notes,trackEnds:[96,96,96,96],attachments:[{tick:0,track:0,order:0,bytes:[255,88,4,4,2,24,8]}]};
}

test('global harmonic palettes bind attacks across instruments and revoice independently of rhythm',()=>{
  const source=score(), scene=call('encodeScore',{score:source});
  assert.deepEqual(call('decodeScene',{scene:JSON.parse(JSON.stringify(scene))}),source);
  assert(scene.harmony);
  const window=scene.harmony.windows.find(w=>w.selected!==null && w.coreNoteIds.includes('0-0'));
  assert(window);assert(window.coreNoteIds.some(id=>source.notes.find(n=>n.id===id)!.part==='third'));
  const frame=scene.program.harmonies!.find(h=>h.id===window.id)!;assert(frame);
  const changedScene=call('changeSceneHarmony',{scene,windowId:window.id,rootMillicents:frame.rootMillicents+100000});
  const changed=call('decodeScene',{scene:changedScene});
  const bound=new Set([...window.coreNoteIds,...window.colorNoteIds].filter(id=>{
    const note=source.notes.find(n=>n.id===id)!;return note.onset>=window.startTick&&note.onset<window.endTick;
  }));
  for(const [i,note] of changed.notes.entries()) {
    assert.equal(note.pitch.millicents,source.notes[i].pitch.millicents+(bound.has(note.id)?100000:0));
    assert.deepEqual({...note,pitch:source.notes[i].pitch},source.notes[i]);
  }
  const allPlacements=[...scene.program.placements,...scene.program.definitions!.flatMap(d=>d.placements)];
  assert(allPlacements.some(p=>p.pitchBindings?.some(b=>b.kind==='harmony')));
  for(const placement of allPlacements.filter(p=>p.pitchBindings)) {
    assert(scene.program.materials.find(m=>m.id===placement.material)!.notes.every(n=>n.pitch.millicents===0));
  }
});

test('harmonic graph membership cannot be silently detached from its analytical roles',()=>{
  const scene=call('encodeScore',{score:score()});
  const window=scene.harmony!.windows.find(w=>w.coreNoteIds.length)!;
  const invalid=structuredClone(scene);invalid.harmony!.windows.find(w=>w.id===window.id)!.coreNoteIds.pop();
  assert.throws(()=>call('decodeScene',{scene:invalid}),/role memberships/);
  const duplicated=structuredClone(scene), roles=duplicated.harmony!.windows.find(w=>w.id===window.id)!.coreNoteIds;
  assert(roles.length>=2);roles[1]=roles[0];
  assert.throws(()=>call('decodeScene',{scene:duplicated}),/role memberships/);
  assert.throws(()=>call('changeSceneHarmony',{scene,windowId:window.id,rootMillicents:0,coreIntervals:[0]}),/cardinality/);
});

test('external executable palettes reject inconsistent core edits without a Wasm trap',()=>{
  const source=score(),scene=call('encodeScore',{score:source});
  const window=scene.harmony!.windows.find(w=>w.selected!==null)!;
  for(const placement of [...scene.program.placements,...scene.program.definitions!.flatMap(d=>d.placements)]) {
    placement.pitchBindings=placement.pitchBindings?.map(binding=>{
      if(binding.kind!=='harmony')return binding;
      const frame=scene.program.harmonies!.find(h=>h.id===binding.harmony)!;
      return {kind:'literal',millicents:frame.rootMillicents+frame.intervals[binding.tone]+binding.octave*1200000+binding.residualMillicents};
    });
  }
  scene.program.harmonies!.find(h=>h.id===window.id)!.intervals=[0];
  assert.deepEqual(call('decodeScene',{scene}),source);
  assert.throws(()=>call('changeSceneHarmony',{scene,windowId:window.id,rootMillicents:0,
    coreIntervals:window.alternatives[window.selected!].coreIntervals}),error=>(error as {code:string}).code==='invalid-input');
});
