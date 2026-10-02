import test from 'node:test';
import assert from 'node:assert/strict';
import { compileComposition, type CompositionPlan } from '../src/score/composition';

const plan = (): CompositionPlan => ({
  context: {ppq:12,duration:48,trackEnds:[48],parts:[{id:'p',name:'Piano',track:0,channel:0,percussion:false}],attachments:[]},
  harmonies:[{id:'h',rootMillicents:0,intervals:[0,400000,700000,900000]}],
  materials:[{id:'rhythm',span:48,notes:[0,6,18,30].map((onset,i)=>({id:String(i),part:'p',onset,duration:12,
    pitch:{millicents:0},velocity:80,releaseVelocity:64,
    pitchEnvelope:[{tick:0,pitch:{millicents:0}},{tick:6,pitch:{millicents:12501}}]}))}],
  placements:[{material:'rhythm',onset:0,pitchBindings:[0,1,2,3].map(tone=>({kind:'harmony',harmony:'h',tone,octave:5,residualMillicents:0}))}],
});

test('one rhythm realizes different chords and colors through the same compiler, preserving exact native curves',()=>{
  const original=plan(), saved=structuredClone(original), first=compileComposition(original);
  assert.deepEqual(first.notes.map(n=>n.pitch.millicents),[6000000,6400000,6700000,6900000]);
  const changed=structuredClone(original); changed.harmonies![0]={id:'h',rootMillicents:200000,intervals:[0,300000,700000,900000]};
  const second=compileComposition(changed);
  assert.deepEqual(second.notes.map(n=>n.pitch.millicents),[6200000,6500000,6900000,7100000]);
  assert.deepEqual(second.notes.map(n=>[n.onset,n.duration,n.velocity,n.part]),first.notes.map(n=>[n.onset,n.duration,n.velocity,n.part]));
  for(const n of second.notes)assert.equal(n.pitchEnvelope![1].pitch.millicents-n.pitch.millicents,12501);
  const rhythm=structuredClone(original); rhythm.materials[0].notes[1].onset=9;
  assert.deepEqual(compileComposition(rhythm).notes.map(n=>n.pitch),first.notes.map(n=>n.pitch));
  assert.deepEqual(original,saved);
});

test('bound voicing composes with nested pitch and rational time transforms; unbound notes remain literal',()=>{
  const input=plan(); input.definitions=[{id:'phrase',span:48,placements:input.placements}];
  input.placements=[{material:'phrase',onset:0,transposeMillicents:37,timeScale:{numerator:2,denominator:3}}];
  const score=compileComposition(input);
  assert.equal(score.notes[0].pitch.millicents,6000037);
  assert.equal(score.notes[1].onset/score.ppq,1/3);
  assert.equal(score.notes[0].pitchEnvelope![1].tick/score.ppq,1/3);
  input.definitions[0].placements[0].pitchBindings![0]={kind:'literal',millicents:6000001};
  assert.equal(compileComposition(input).notes[0].pitch.millicents,6000038);
});

test('unresolved, malformed or unsafe harmonic bindings fail explicitly',()=>{
  for(const mutate of [
    (p:CompositionPlan)=>{p.harmonies=[];},
    (p:CompositionPlan)=>{p.placements[0].pitchBindings!.pop();},
    (p:CompositionPlan)=>{p.harmonies![0].intervals=[];},
    (p:CompositionPlan)=>{p.harmonies!.push(p.harmonies![0]);},
    (p:CompositionPlan)=>{p.placements[0].pitchBindings![0]={kind:'harmony',harmony:'h',tone:99,octave:5,residualMillicents:0};},
    (p:CompositionPlan)=>{p.placements[0].pitchBindings![0]={kind:'literal',millicents:Number.MAX_SAFE_INTEGER};p.placements[0].transposeMillicents=1;},
  ]) {const p=plan();mutate(p);assert.throws(()=>compileComposition(p),/palette|binding|pitch/);}
});
