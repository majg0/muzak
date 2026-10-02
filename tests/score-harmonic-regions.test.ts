import test from 'node:test';
import assert from 'node:assert/strict';
import { inferHarmonicRegions } from '../src/score/harmonic-regions';
import { stretchScore, transposeScore } from '../src/score/operations';
import type { Score, ScoreNote } from '../src/score/score';
import { callCoreSync } from '../src/core/sync';

const note = (id: string, onset: number, duration: number, pitch: number, part = 'a'): ScoreNote =>
  ({ id, onset, duration, part, pitch: { millicents: pitch }, velocity: 80, releaseVelocity: 64 });
const score = (notes: ScoreNote[]): Score => {
  const duration = notes.reduce((end, note) => Math.max(end, note.onset + note.duration), 0);
  return { ppq: 6, duration, notes, parts: ['a', 'b'].map((id, track) => ({ id, name: '', track, channel: track, percussion: false })),
    trackEnds: [duration, duration], attachments: [] };
};

test('Rust harmonic overlays retain exact memberships, native interval parameters and namespaced parent relations', () => {
  const input = transposeScore(example(), 1537), result = inferHarmonicRegions(input, { parts: ['a'] });
  const regions = callCoreSync('harmonicStructureRegions', { analysis: result, namespace: 'a:' });
  assert.equal(regions.length, result.harmonicRuns.length + result.cohorts.filter(item => item.selected).length + result.melodyCells.length);
  const ids = new Set(regions.map(region => region.id));
  assert.equal(ids.size, regions.length);
  assert.ok(regions.every(region => region.id.startsWith('harmonic:a:') && (region.parentIds ?? []).every(parent => ids.has(parent))));
  const cell = result.melodyCells[0], region = regions.find(region => region.id === `harmonic:a:${cell.id}`)!;
  assert.deepEqual(region.noteIds, cell.noteIds);
  const intervals = JSON.parse(region.parameters.find(parameter => parameter.key === 'melody-relative-bass')!.value);
  assert.deepEqual(intervals.flat(), cell.bassRelativeMillicents, 'parameter retains octaves, multiplicity and coincident native values');
  const harmony = regions.find(region => region.id === `harmonic:a:${result.harmonicRuns[0].id}`)!;
  const classes: string[] = JSON.parse(harmony.parameters.find(parameter => parameter.key === 'support-chord')!.value);
  assert.ok(classes.every(value => BigInt(value) % 100000n === 1537n), 'native pitch classes are not rounded for equivalence');
  const duplicate = callCoreSync('harmonicStructureRegions', { analysis: result, namespace: 'b:' });
  assert.deepEqual(duplicate.map(region => region.parameters), regions.map(region => region.parameters), 'source namespaces affect addresses, not parameter identity');
  const broken = structuredClone(result); broken.melodyCells[0].runId = 'missing';
  assert.throws(() => callCoreSync('harmonicStructureRegions', { analysis: broken, namespace: '' }), /Unknown harmonic run/);
});
function example(): Score {
  const roots = [4800000, 4600000, 4800000, 4500000, 4800000, 4600000];
  const notes = roots.flatMap((root, cell) => {
    const start = cell * 24;
    const support = [0, 12].flatMap((offset, repeat) => [0, 700000, 1200000].flatMap((pitch, index) => {
      const onset = start + offset + 2 * index, end = start + offset + 12;
      return cell === 1 && repeat === 0 && index === 2
        ? [note(`support-${cell}-${repeat}-${index}`, onset, 3, root + pitch), note('retrig', onset + 3, end - onset - 3, root + pitch)]
        : [note(`support-${cell}-${repeat}-${index}`, onset, end - onset, root + pitch)];
    }));
    const melody = [5, 8, 10, 13, 17, 17].map((offset, i) => note(`upper-${cell}-${i}`, start + offset,
      [1, 1, 2, 1, 2, 2][i], [6500000, 6800000, 7200000, 7400000, 7900000, 8400000][i] - (cell === 3 && i === 1 ? 100000 : 0)));
    return [...support, ...melody];
  });
  return score(notes);
}

test('recurrent release-prefix support separates sparse upper notes without fixed periods or register cuts', () => {
  const input = example(), saved = structuredClone(input), result = inferHarmonicRegions(input, { parts: ['a'] });
  const selected = result.cohorts.filter(cohort => cohort.selected);
  assert.equal(selected.length, 12);
  assert.ok(selected.every(cohort => cohort.supportPitches.length === 3));
  assert.equal(result.families.find(family => family.selected)!.occurrences, 12);
  assert.equal(result.harmonicRuns.length, 6);
  assert.deepEqual(result.harmonicRuns.map(run => [run.startTick, run.endTick]), [0, 1, 2, 3, 4, 5].map(i => [24 * i, 24 * (i + 1)]));
  assert.ok(result.harmonicRuns.every(run => run.quality === 'open-fifth'));
  assert.ok(result.melodyCells.every(cell => cell.noteIds.length === 6));
  assert.deepEqual(result.melodyCells[0].attackOffsetsTicks, [5, 8, 10, 13, 17, 17]);
  assert.ok(result.melodyCells.every(cell => cell.rhythmOccurrences === 6));
  assert.equal(new Set(result.melodyCells.map(cell => cell.rhythmKey)).size, 1);
  assert.equal(result.melodyCells[3].pitchDifferences.length, 1);
  assert.equal(result.melodyCells.filter(cell => !cell.pitchDifferences.length).length, 5);
  assert.deepEqual(result.melodyCells[3].pitchDifferences[0], { noteId: 'upper-3-1', index: 1, observedMillicents: 6700000, templateMillicents: 6800000 });
  assert.notDeepEqual(result.melodyCells[0].bassRelativeMillicents, result.melodyCells[1].bassRelativeMillicents);
  assert.deepEqual(result.melodyCells[0].absolutePitches, result.melodyCells[1].absolutePitches);
  assert.ok(result.families.some(family => !family.selected && family.supportPitchCount === 2), 'Repeated upper dyad remains an alternative observation.');
  assert.deepEqual(input, saved);
});

test('analytical touching-run merge preserves retrigger IDs but shared releases keep support restarts', () => {
  const input = example(), result = inferHarmonicRegions(input, { parts: ['a'] });
  assert.equal(result.diagnostics.mergedReattacks, 1);
  const merged = result.heldRuns.find(run => run.noteIds.includes('retrig'))!;
  assert.deepEqual(merged.noteIds, ['retrig', 'support-1-0-2']);
  assert.equal(merged.startTick, 28); assert.equal(merged.endTick, 36);
  assert.ok(result.heldRuns.some(run => run.pitchMillicents === 4800000 && run.startTick === 0 && run.endTick === 12));
  assert.ok(result.heldRuns.some(run => run.pitchMillicents === 4800000 && run.startTick === 12 && run.endTick === 24));
  assert.ok(result.harmonicRuns.find(run => run.startTick === 24)!.noteIds.includes('retrig'));
  assert.equal(input.notes.find(note => note.id === 'retrig')!.onset, 31);
});

test('shape/rhythm inference is invariant to exact uniform time scaling, native transposition and arbitrary IDs', () => {
  const original = example(), baseline = inferHarmonicRegions(original, { parts: ['a'] });
  const changed = transposeScore(stretchScore(original, 3, 1), 237501);
  changed.notes = changed.notes.map((note, i) => ({ ...note, id: `renamed-${i}` })).reverse();
  const result = inferHarmonicRegions(changed, { parts: ['a'] });
  assert.deepEqual(result.families.map(family => [family.shapeKey, family.occurrences, family.selected]), baseline.families.map(family => [family.shapeKey, family.occurrences, family.selected]));
  assert.deepEqual(result.melodyCells.map(cell => cell.rhythmKey), baseline.melodyCells.map(cell => cell.rhythmKey));
  assert.deepEqual(result.melodyCells.map(cell => cell.bassRelativeMillicents), baseline.melodyCells.map(cell => cell.bassRelativeMillicents));
  assert.deepEqual(result.harmonicRuns.map(run => run.startTick), baseline.harmonicRuns.map(run => run.startTick * 3));
  assert.deepEqual(result.melodyCells[0].absolutePitches, baseline.melodyCells[0].absolutePitches.map(pitch => pitch + 237501));
});

test('independent part counts are not inflated by duplicated orchestration', () => {
  const original = example(), doubled = structuredClone(original);
  doubled.notes.push(...original.notes.map(note => ({ ...structuredClone(note), id: `double-${note.id}`, part: 'b' })));
  const result = inferHarmonicRegions(doubled, { parts: ['a', 'b'] });
  assert.deepEqual(result.families.filter(family => family.selected).map(family => family.occurrences), [12, 12]);
  assert.equal(result.melodyCells.length, 12);
  assert.ok(result.melodyCells.every(cell => cell.rhythmOccurrences === 6));
  assert.equal(new Set(result.harmonicRuns.flatMap(run => run.noteIds)).size, 74);
});

test('negative pitch intervention and grouping-prior changes remain visible', () => {
  const changed = example(); changed.notes.find(note => note.id === 'support-0-0-2')!.pitch.millicents += 100000;
  const result = inferHarmonicRegions(changed, { parts: ['a'] });
  assert.equal(result.cohorts.filter(cohort => cohort.selected).length, 11);
  assert.ok(!result.cohorts.some(cohort => cohort.selected && cohort.startTick === 0));
  const stricter = inferHarmonicRegions(example(), { parts: ['a'] }, { minGapContrast: 100 });
  assert.equal(stricter.cohorts.filter(cohort => cohort.selected).length, 6);
  assert.ok(stricter.harmonicRuns.every(run => run.startTick % 24 === 12));
});

test('equal dominant shape and modal-pitch explanations stay explicitly ambiguous', () => {
  const notes = [0, 1, 2, 3].flatMap(i => [0, i % 2 ? 300000 : 400000, 700000].map((pitch, j) => note(`${i}-${j}`, i * 10 + j, 8 - j, 4800000 + pitch)));
  const tied = inferHarmonicRegions(score(notes), { parts: ['a'] });
  assert.deepEqual(tied.diagnostics.ambiguousParts, ['a']);
  assert.equal(tied.families.filter(family => family.tied).length, 2);
  assert.equal(tied.harmonicRuns.length, 0);
  const input = example();
  for (const note of input.notes) if (note.id.startsWith('upper-') && Number(note.id.split('-')[1]) >= 3) note.pitch.millicents += 100000;
  input.notes.find(note => note.id === 'upper-3-1')!.pitch.millicents += 100000;
  const templateTie = inferHarmonicRegions(input, { parts: ['a'] });
  assert.ok(templateTie.melodyCells.every(cell => cell.templateTied && cell.templatePitches === null));
});

test('bounds, unsupported performance and empty observations fail or report explicitly', () => {
  const input = example(), saved = structuredClone(input);
  const baseline = inferHarmonicRegions(input, { parts: ['a'] });
  assert.equal(baseline.diagnostics.candidateMembers, baseline.cohorts.reduce((sum, cohort) => sum + cohort.runIds.length + cohort.noteIds.length, 0), 'Merged retrigger evidence is charged as actual source-ID storage.');
  assert.doesNotThrow(() => inferHarmonicRegions(input, { parts: ['a'] }, { maxCandidateMembers: baseline.diagnostics.candidateMembers }));
  assert.throws(() => inferHarmonicRegions(input, { parts: ['a'] }, { maxCandidateMembers: baseline.diagnostics.candidateMembers - 1 }), /candidate-member budget/);
  assert.throws(() => inferHarmonicRegions(input, {}), /explicit/);
  assert.throws(() => inferHarmonicRegions(input, { parts: ['a'] }, { maxCandidateMembers: 1 }), /candidate-member budget/);
  assert.throws(() => inferHarmonicRegions(input, { parts: ['a'] }, { maxContextMembers: 1 }), /context-member budget/);
  assert.deepEqual(input, saved);
  assert.throws(() => inferHarmonicRegions(input, { parts: ['a'] }, { minGapContrast: 1 }), /exceed/);
  input.notes[0].pitchEnvelope = [{ tick: 0, pitch: { ...input.notes[0].pitch } }, { tick: 1, pitch: { millicents: input.notes[0].pitch.millicents + 1000 } }];
  input.notes.push(note('zero', 0, 0, 6000000));
  const result = inferHarmonicRegions(input, { parts: ['a'] });
  assert.deepEqual(result.diagnostics.excludedExpressiveNoteIds, ['support-0-0-0']);
  assert.deepEqual(result.diagnostics.excludedZeroDurationNoteIds, ['zero']);
  assert.equal(inferHarmonicRegions(score([]), { parts: ['a'] }).harmonicRuns.length, 0);
});

test('simultaneous support prefixes can separate a later co-releasing attack with explicit zero-spread evidence', () => {
  const notes = [4800000, 4600000, 4300000].flatMap((root, i) => [
    ...[0, 700000, 1200000].map((pitch, j) => note(`support-${i}-${j}`, i * 12, 12, root + pitch)),
    note(`late-${i}`, i * 12 + 10, 2, 7900000),
  ]);
  const result = inferHarmonicRegions(score(notes), { parts: ['a'] });
  const selected = result.cohorts.filter(cohort => cohort.selected);
  assert.equal(selected.length, 3);
  assert.ok(selected.every(cohort => cohort.split === 'attack-gap-prefix' && cohort.gapContrast === null));
  assert.ok(selected.every(cohort => cohort.gapEvidence?.precedingMaxGapTicks === 0 && cohort.gapEvidence.followingGapTicks === 10));
  assert.ok(result.melodyCells.every(cell => cell.noteIds.length === 1));
});

test('rhythm identity does not depend on pitches assigned to simultaneous notes of different durations', () => {
  const original = example();
  for (const note of original.notes) if (note.id.startsWith('upper-') && note.id.endsWith('-5')) note.duration = 3;
  const changed = structuredClone(original);
  const a = changed.notes.find(note => note.id === 'upper-0-4')!, b = changed.notes.find(note => note.id === 'upper-0-5')!;
  [a.pitch, b.pitch] = [b.pitch, a.pitch];
  const before = inferHarmonicRegions(original, { parts: ['a'] }), after = inferHarmonicRegions(changed, { parts: ['a'] });
  assert.deepEqual(after.melodyCells.map(cell => cell.rhythmKey), before.melodyCells.map(cell => cell.rhythmKey));
  assert.equal(after.melodyCells[0].pitchDifferences.length, 2);
  assert.ok(after.melodyCells.every(cell => cell.rhythmOccurrences === 6));
});
