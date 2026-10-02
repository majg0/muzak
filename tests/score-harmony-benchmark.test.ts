import test from 'node:test';
import assert from 'node:assert/strict';
import { alignReferences, compactHarmonyMetrics, diagnoseHarmony, evaluateHarmony, latticeHarmonyCeiling, loadDevelopment, localTonic, nativeHarmonyBackend, oracleHarmony, parseHarmonyArguments, parseTable, scoreObservations } from '../scripts/evaluate-harmony';
import type { HarmonicReference, HarmonyPrediction, HarmonyWork } from '../scripts/evaluate-harmony';
import { exportScoreMidi, importMidi } from '../src/score/midi-score';
import { callCoreSync } from '../src/core/sync';

const row = (id: string, onset: number, duration: number, more = {}) => ({ id: `${id}-1`, xml_mn: '1', mn: '1', voice: '1', pitch: '60', onset_div: String(onset), duration_div: String(duration), label: '', chord: '', ...more });
const xml = `<score-partwise><part id="p"><measure number="1"><attributes><divisions>4</divisions><time><beats>6</beats><beat-type>8</beat-type></time></attributes><note id="a"><pitch/><duration>4</duration></note><!-- <note id="discard"><duration>400</duration></note> --><note id="g"><grace/><pitch/></note><note id="b"><pitch/><duration>4</duration></note><note><rest/><duration>4</duration></note></measure></part></score-partwise>`;
const observed = [row('a', 0, 4), row('g', 4, 0), row('b', 4, 4)];
const cMajor = { rootMillicents: 0, coreIntervals: [0, 400_000, 700_000], colorIntervals: [] };
const gMajor = { rootMillicents: 700_000, coreIntervals: [0, 400_000, 700_000], colorIntervals: [] };
const window = (startTick: number, endTick: number, alternative = cMajor, selected: number | null = 0) => ({ startTick, endTick, selected, alternatives: [alternative] });
const reference = (startTick: number, endTick: number, root = 0, core = [0, 400_000, 700_000]): HarmonicReference => ({ startTick, endTick, label: 'independent', root, core, added: [] });

test('strict table parser preserves quoted labels; malformed rows and duplicate headers fail', () => {
  assert.deepEqual(parseTable('id,label\r\na,"I(6,4)"\r\nb,"line\n""two"""'), [{ id: 'a', label: 'I(6,4)' }, { id: 'b', label: 'line\n"two"' }]);
  for (const input of ['a,a\n1,2', 'a,b\n1', 'a,b\n1,"x"z', 'a,b\n1,"x']) assert.throws(() => parseTable(input));
});

test('score projection uses exact divisions and keeps nominal grace/rest extents without consulting labels', () => {
  const { score } = scoreObservations(observed, xml, 4);
  assert.deepEqual(score.notes.map(n => [n.onset, n.duration]), [[0, 4], [4, 0], [4, 4]]);
  assert.equal(score.duration, 12);
  assert.deepEqual(score.attachments[1].bytes, [255, 88, 4, 6, 3, 24, 8]);
  const protectedRows = observed.map(r => ({ ...r, onset_beat: '999', duration_quarter: '999', get label(): never { throw new Error('Label leakage'); }, get chord(): never { throw new Error('Chord leakage'); } }));
  assert.deepEqual(scoreObservations(protectedRows, xml, 4).score, score);
  assert.throws(() => scoreObservations([...observed, observed[0]], xml, 4), /duplicate/);
  assert.throws(() => scoreObservations([observed[0], observed[1], {...observed[2],onset_div:'5'}], xml, 4), /measure start/);
});

test('heldout admission happens before any asset read or hash check', () => {
  let reads = 0;
  assert.throws(() => loadDevelopment({ id: 'unseen', split: 'holdout' } as HarmonyWork, () => { reads++; throw new Error('Read forbidden'); }), /Heldout/);
  assert.equal(reads, 0);
});

test('derived MIDI preserves source notated-voice labels without inferring instrument or voice roles', () => {
  const rows = [observed[0], {...observed[1],voice:'5'}, {...observed[2],voice:'6'}];
  const {score} = scoreObservations(rows,xml,4);
  const imported = importMidi(exportScoreMidi(score)).score;
  assert.deepEqual(imported.parts.map(p=>p.name), ['Notated voice 1','Notated voice 5','Notated voice 6']);
  const geometry = (s:typeof score) => s.notes.map(n=>[s.parts.find(p=>p.id===n.part)!.name,n.onset,n.duration,n.pitch.millicents,n.velocity,n.releaseVelocity]);
  assert.deepEqual(geometry(imported),geometry(score));
  assert.equal(imported.duration,score.duration);
});

test('DCML fifth stacks are local-tonic intervals, and label roots can differ from core triad roots', () => {
  assert.equal(localTonic('C', 'V/V'), 200_000);
  assert.equal(localTonic('a', 'VI'), 500_000);
  assert.equal(localTonic('A', 'i'), 900_000);
  assert.throws(() => localTonic('C', 'iV'), /degree/);
  const rows = observed.map((r, i) => i ? r : { ...r, label: 'V(64)', chord: 'V(64)', globalkey: 'C', localkey: 'I', duration_qb: '3' });
  const { score, xmlNotes } = scoreObservations(rows, xml, 4);
  const independent = [{ mn: '1', label: 'V(64)', chord: 'V(64)', globalkey: 'C', localkey: 'I', mn_onset: '0', root: '1', chord_tones: '0, 4, 1', added_tones: '' }];
  const result = alignReferences(rows, independent, xmlNotes, score);
  assert.equal(result.references[0].root, 700_000);
  assert.deepEqual(result.references[0].core, [0, 400_000, 700_000]);
  assert.equal(result.diagnostics.unsupported.length, 0);
  const mismatch = alignReferences(rows, [{ ...independent[0], mn_onset: '1/16' }], xmlNotes, score);
  assert.match(mismatch.references[0].issue!, /disagrees/);
});

test('invalid edited XML measure is surfaced; note observations survive without repaired offsets', () => {
  const invalid = xml.replace('<note id="b">', '<backup><duration>20</duration></backup><note id="b">');
  const rows = observed.map((r, i) => i ? r : { ...r, label: 'I', chord: 'I', globalkey: 'C', localkey: 'I' });
  const { score, xmlNotes } = scoreObservations(rows, invalid, 4);
  assert.deepEqual(score.notes.map(n => [n.onset, n.duration]), [[0, 4], [4, 0], [4, 4]]);
  const aligned = alignReferences(rows, [], xmlNotes, score);
  assert.match(aligned.references[0].issue!, /moves before its start/);
});

test('overlap duration penalizes wrong and ambiguous windows without oracle alternative selection', () => {
  const predicted: HarmonyPrediction = { windows: [window(0, 2), window(2, 3, gMajor), window(3, 4, cMajor, null)] };
  const metrics = evaluateHarmony(predicted, [reference(0, 4)], 1, 4);
  assert.equal(metrics.coreAccuracy, .5);
  assert.equal(metrics.rootAccuracy, .5);
  assert.equal(metrics.selectedCoverage, .75);
  assert.equal(metrics.boundaries.referenceCount, 0);
  assert.equal(metrics.boundaries.estimatedCount, 1);
  assert.equal(metrics.boundaries.f1, 0);
  assert.equal(metrics.nonemptyAddedSetAccuracy, null, 'Empty addition fields do not establish nonchord-role accuracy.');
});

test('a functional dominant root changes only root agreement, preserving the tonic-major realized pitch classes', () => {
  const refs=[reference(0,4,700_000)]; // V(64): reference root G, realized notes C/E/G.
  const ordinary:HarmonyPrediction={windows:[window(0,4)]};
  const contextual:HarmonyPrediction={windows:[{...window(0,4),
    functionalRoot:{rootMillicents:700_000,realizationAlternativeIndex:0}}]};
  const before=evaluateHarmony(ordinary,refs,1,4),after=evaluateHarmony(contextual,refs,1,4);
  assert.equal(before.coreAccuracy,1);assert.equal(before.rootAccuracy,0);
  assert.equal(after.coreAccuracy,1);assert.equal(after.rootAccuracy,1);assert.equal(after.jointAccuracy,1);
  assert.equal(after.referenceTicks,before.referenceTicks);

  contextual.windows[0].alternatives.push(gMajor);
  contextual.windows[0].functionalRoot!.realizationAlternativeIndex=1;
  assert.equal(evaluateHarmony(contextual,refs,1,4).jointAccuracy,0,'An extension attached to another alternative cannot override the selected one.');
  contextual.windows[0].selected=null;
  assert.equal(evaluateHarmony(contextual,refs,1,4).selectedCoverage,0,'A functional-root proposal does not turn an abstention into a selection.');
});

test('boundaries compare harmonic content changes, ignore repeated labels and never union unsupported spans', () => {
  const refs = [reference(0, 2), reference(2, 4), reference(4, 6, 700_000, [200_000, 700_000, 1_100_000]), { ...reference(6, 8), issue: 'uncertain' }, reference(8, 10)];
  const metrics = evaluateHarmony({ windows: [window(0, 1), window(1, 4), window(4, 6, gMajor), window(6, 8, gMajor), window(8, 10)] }, refs, 1, 10);
  assert.equal(metrics.referenceTicks, 8);
  assert.equal(metrics.coreAccuracy, 1);
  assert.equal(metrics.boundaries.referenceCount, 1);
  assert.equal(metrics.boundaries.estimatedCount, 1);
  assert.equal(metrics.boundaries.f1, 1);
  const none = evaluateHarmony({ windows: [] }, [{ ...reference(0, 4), issue: 'no usable reference' }], 1, 4);
  assert.equal(none.coreAccuracy, null); assert.equal(none.boundaries.f1, null);
});

test('overlapping windows/references and malformed selected labels fail instead of inflating metrics', () => {
  assert.throws(() => evaluateHarmony({ windows: [window(0, 3), window(2, 4)] }, [reference(0, 4)], 1, 4), /Overlapping/);
  assert.throws(() => evaluateHarmony({ windows: [] }, [reference(0, 3), reference(2, 4)], 1, 4), /overlapping/);
  assert.throws(() => evaluateHarmony({ windows: [window(0, 4, cMajor, 2)] }, [reference(0, 4)], 1, 4), /selected/);
});

test('segmentation boundaries remain evaluable when every harmonic interpretation is ambiguous', () => {
  const refs = [reference(0, 2), reference(2, 4, 700_000, [200_000, 700_000, 1_100_000])];
  const result = evaluateHarmony({ windows: [window(0, 1, cMajor, null), window(1, 2, cMajor, null), window(2, 4, cMajor, null)] }, refs, 1, 4);
  assert.equal(result.selectedCoverage, 0);
  assert.equal(result.boundaries.estimatedCount, 0);
  assert.equal(result.boundaries.matched, 0);
  assert.equal(result.segmentationBoundaries.estimatedCount, 2);
  assert.equal(result.segmentationBoundaries.matched, 1);
  assert.equal(result.segmentationBoundaries.precision, .5);
  assert.equal(result.segmentationBoundaries.recall, 1);
  assert.equal(result.segmentationBoundaries.f1, 2/3);
});

test('lattice attainability isolates unavailable boundary positions without altering labels or inference', () => {
  const refs = [reference(0, 1), reference(1, 3, 700_000, [200_000, 700_000, 1_100_000]), reference(3, 4)];
  const prediction = { windows: [window(0, 4)] };
  const plain = evaluateHarmony(prediction, refs, 1, 4);
  const measured = evaluateHarmony(prediction, refs, 1, 4, [{tick:0},{tick:1},{tick:2},{tick:4}]);
  assert.deepEqual(measured.latticeAttainability, {referenceChanges:2,onLattice:1,fraction:.5,offLatticeTicks:[3]});
  assert.deepEqual(measured.segmentationBoundaries, plain.segmentationBoundaries);
  assert.equal(measured.coreAccuracy, plain.coreAccuracy);
  assert.throws(()=>evaluateHarmony(prediction,refs,1,4,[{tick:1},{tick:1}]),/lattice/);
});

test('label-change lattice excludes computational cuts without changing strict agreement', () => {
  const refs = [reference(0, 1), reference(1, 3, 700_000, [200_000, 700_000, 1_100_000]), reference(3, 4)];
  const prediction = {windows:[window(0,4)]};
  const plain = evaluateHarmony(prediction,refs,1,4);
  const measured = evaluateHarmony(prediction,refs,1,4,[
    {tick:0,changeSupported:true},{tick:1,changeSupported:false},{tick:3,changeSupported:true},{tick:4,changeSupported:true},
  ]);
  assert.deepEqual(measured.latticeAttainability,{referenceChanges:2,onLattice:2,fraction:1,offLatticeTicks:[]});
  assert.deepEqual(measured.changeLatticeAttainability,{referenceChanges:2,onLattice:1,fraction:.5,offLatticeTicks:[1]});
  assert.equal(measured.coreAccuracy,plain.coreAccuracy);
  assert.deepEqual(measured.boundaries,plain.boundaries);
  assert.deepEqual(measured.segmentationBoundaries,plain.segmentationBoundaries);
  assert.equal(plain.changeLatticeAttainability,undefined);
  assert.throws(()=>evaluateHarmony(prediction,refs,1,4,[{tick:0,changeSupported:true},{tick:1}]),/change-supported/);
});

function triadScore() {
  const score=scoreObservations(observed,xml,4).score;
  score.notes=[0,400_000,700_000].map((p,i)=>({...score.notes[0],id:`original-triad-${i}`,onset:0,duration:12,pitch:{millicents:6_000_000+p}}));
  return score;
}

test('template ceiling separates chord content from contextual root and unavailable replacement intervals', () => {
  const score=triadScore(), analysis=callCoreSync('inferGlobalHarmony',{score});
  // This metric control defines its own vocabulary; adding valid production
  // templates must not turn a diagnostic regression into a tuning constraint.
  analysis.parameters.templates=[{id:'major',label:'major',coreIntervals:[0,400_000,700_000],colorIntervals:[]}];
  analysis.windows=[{...analysis.windows[0],startTick:0,endTick:12,selected:0,
    alternatives:[{...analysis.windows[0].alternatives[0],...cMajor,label:'major'}]}];
  const refs=[reference(0,4),reference(4,8,700_000),reference(8,12,0,[0,500_000,700_000])];
  const diagnosis=diagnoseHarmony(score,analysis,refs);
  assert.equal(diagnosis.coreVocabularyCeiling,2/3);
  assert.equal(diagnosis.flatJointVocabularyCeiling,1/3);
  assert.equal(diagnosis.adjacentRelations.changedRootSameCore,1);
  assert.deepEqual(diagnosis.perReference[1].sameRootTemplates,[]);
  assert.ok(diagnosis.perReference[1].coreMatches.some(m=>m.root===0&&m.template==='major'));
  assert.deepEqual(diagnosis.perReference[2].coreMatches,[]);
  assert.deepEqual(diagnosis.perReference[2].missingObservedCore,[500_000]);
  assert.equal(diagnosis.errorPartition.correctTicks,4);
  assert.equal(diagnosis.errorPartition.flatRootRealizationGapErrorTicks,4);
  assert.equal(diagnosis.errorPartition.unrepresentableCoreTicks,4);
  assert.equal(diagnosis.errorPartition.flatRepresentableUnselectedTicks,0);
  assert.equal(diagnosis.errorPartition.flatRepresentableSelectedWrongTicks,0);
  const extended=structuredClone(analysis);
  Object.assign(extended.windows[0],{functionalRoot:{rootMillicents:700_000,realizationAlternativeIndex:0}});
  const contextual=diagnoseHarmony(score,extended,[reference(0,12,700_000)]);
  assert.equal(contextual.flatJointVocabularyCeiling,0,'The flat vocabulary still cannot name the rooted realization.');
  assert.equal(contextual.functionalExtension.appliedReferenceTicks,12);
  assert.equal(contextual.functionalExtension.jointCorrectTicks,12);
  assert.equal(contextual.errorPartition.correctTicks,12,'The extension can be correct despite a zero flat-template bound.');
  assert.equal(contextual.errorPartition.flatRootRealizationGapErrorTicks,0);
});

test('offline oracle uses only supplied bounds, keeps label-dependent selection out and leaves source untouched', () => {
  const score=triadScore(), before=JSON.stringify(score), parameters=callCoreSync('inferGlobalHarmony',{score}).parameters;
  const a=oracleHarmony(score,[reference(4,8)],parameters),b=oracleHarmony(score,[reference(4,8,700_000)],parameters);
  assert.equal(JSON.stringify(score),before);
  assert.equal(a.summary.unavailableIntervals,0);
  assert.equal(a.summary.evaluatedIntervals,1);
  assert.deepEqual(a.intervals[0].selected,b.intervals[0].selected);
  assert.deepEqual(a.intervals[0].alternatives,b.intervals[0].alternatives);
  assert.equal(a.intervals[0].carriedIn,3);
  assert.equal(a.summary.coreAccuracy,1);
  assert.equal(a.summary.rootAccuracy,1);
  assert.equal(b.summary.rootAccuracy,0);
  assert.equal(a.summary.forcedFirstRank.jointAccuracy,1);
  assert.equal(b.summary.retainedCandidateContainment.jointCoverage,0);
});

test('experiment flags accept explicit options and output paths without silently ignoring misspellings', () => {
  const args=parseHarmonyArguments(['--native=target/release/muzak-core.exe','--options=.audit/example.json','--out','.audit/result.json','--compact','--diagnostics']);
  assert.equal(args.native,'target/release/muzak-core.exe');
  assert.equal(args.optionsPath,'.audit/example.json');
  assert.equal(args.output,'.audit/result.json');
  assert.equal(args.compact,true);assert.equal(args.diagnostics,true);
  assert.match(parseHarmonyArguments(['--native']).native!,/target[\\/]debug[\\/]muzak-core/);
  for(const invalid of [['--holdout'],['--options'],['--options='],['--compact=true'],['--native='],['--compact','--compact'],['--prepare','--options=x']]) {
    assert.throws(()=>parseHarmonyArguments(invalid));
  }
});

test('compact reports retain every strict numerator, denominator and boundary count', () => {
  const metrics=evaluateHarmony({windows:[window(0,2),window(2,4,gMajor),window(4,6,cMajor,null)]},[reference(0,6)],1,6);
  const before=structuredClone(metrics),compact=compactHarmonyMetrics(metrics);
  assert.deepEqual(metrics,before);
  for(const key of ['referenceTicks','selectedTicks','coreCorrectTicks','rootCorrectTicks','jointCorrectTicks','coreAccuracy','rootAccuracy','jointAccuracy'] as const) {
    assert.equal(compact[key],metrics[key]);
  }
  for(const key of ['boundaries','segmentationBoundaries'] as const) {
    const {spans:_spans,...expected}=metrics[key];assert.deepEqual(compact[key],expected);
    assert.ok(!('spans' in compact[key]));
  }
});

test('lattice upper bound is an explicit reference oracle and separates timing limits from flat-template limits', () => {
  const templates=[{id:'major',label:'major',coreIntervals:[0,400_000,700_000],colorIntervals:[]}];
  const refs=[reference(0,1),reference(1,4,700_000)];
  const lattice=[{tick:0,changeSupported:true},{tick:1,changeSupported:false},{tick:2,changeSupported:true},{tick:4,changeSupported:true}];
  const snapshot=structuredClone(refs),bound=latticeHarmonyCeiling(refs,lattice,4,templates);
  assert.equal(bound.referenceTicks,4);
  assert.equal(bound.unrestrictedCoreCeiling,1,'Both reference functions realize the same chord.');
  assert.equal(bound.unrestrictedJointCeiling,.75,'The first cell cannot change root at unavailable tick1.');
  assert.equal(bound.flatTemplateJointCeiling,.25,'A flat major template cannot represent G-rooted C/E/G.');
  assert.equal(bound.flatTemplateCoreCeiling,1);
  assert.deepEqual(refs,snapshot);
  const admitted=[{...reference(0,1),issue:'uncertain'},reference(1,4,700_000)];
  assert.equal(latticeHarmonyCeiling(admitted,lattice,4,templates).referenceTicks,3);
  assert.equal(latticeHarmonyCeiling(admitted,lattice,4,templates).unrestrictedJointCeiling,1);
  assert.throws(()=>latticeHarmonyCeiling(refs,[{tick:0},{tick:2}],4,templates),/endpoints/);
});

test('one persistent native backend serves ordered experiments and rejects unknown options without losing later requests', async () => {
  const backend=nativeHarmonyBackend(parseHarmonyArguments(['--native']).native!);
  try {
    const score=triadScore();
    const requests=await Promise.all([
      backend.infer(score,{boundaryCost:.03}),
      assert.rejects(backend.infer(score,{boundaryCosts:0} as never),/unknown field/),
      backend.infer(score,{boundaryCost:.07}),
    ]);
    assert.equal(requests[0].parameters.boundaryCost,.03);
    assert.equal(requests[2].parameters.boundaryCost,.07);
    assert.deepEqual(requests[0].windows.map(w=>[w.startTick,w.endTick]),requests[2].windows.map(w=>[w.startTick,w.endTick]));
    await assert.rejects(backend.infer(score,{boundaryCost:NaN}),/finite/);
  } finally { await backend.close(); }
});
