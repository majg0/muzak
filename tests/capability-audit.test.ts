import test from 'node:test';
import assert from 'node:assert/strict';
import { capabilityArgumentCohort, capabilityCases, capabilityScoreSummary, generateCapabilityStudy } from '../src/capability-audit';
import { COMPOSITION_STUDIES, compositionStudy } from '../src/composition-studies';
import { createPerformance, parsePerformance, serializePerformance } from '../src/serialization';
import { degreeToPitch } from '../src/pitch';
import { MusicEngine } from '../src/engine';
import { PPQ, type NoteEvent } from '../src/types';

test('study recipes are independent editable serializable vectors with a common seed and tempo', () => {
  const source = createPerformance('study-source'), original = structuredClone(source);
  for (const study of COMPOSITION_STUDIES) {
    const recipe = compositionStudy(source, study.id);
    const serialized = serializePerformance(recipe);
    assert.deepEqual(JSON.parse(serializePerformance(parsePerformance(serialized))), JSON.parse(serialized));
    recipe.initialParameters.ideaDensity = .123;
    recipe.phrasing!.composition!.embellishment = .987;
    recipe.sound.spectrum.partials[0].amplitude = .0123;
    assert.deepEqual(source, original);
  }
  const cases = capabilityCases('study-source', 104);
  assert.equal(cases.length, 6);
  assert.ok(cases.every(item => item.recipe.seed === 'study-source' && item.recipe.initialParameters.tempo === 104
    && item.recipe.conductor!.tuningTravel === false && item.recipe.sound.instrument === 'ensemble'));
  assert.deepEqual([...new Set(cases.map(item => item.recipe.sound.tuning))].sort(), ['12tet', '19edo', '24edo', '31edo']);
  assert.equal(new Set(cases.map(item => JSON.stringify(item.recipe.initialParameters))).size, 6);
  assert.throws(() => capabilityCases('study-source', NaN));
});

test('score metadata counts actual native notes, source gates and ornament figures independently of labels', () => {
  const recipe = capabilityCases()[4].recipe;
  const frame = new MusicEngine({ seed: recipe.seed, parameters: recipe.initialParameters, sound: recipe.sound }).step();
  const note = (id: string, tick: number, duration: number, degree: number, sourceId = 'core:head'): NoteEvent => ({
    id, tick, duration, absolutePitch: degreeToPitch('24edo', degree), voice: 5, part: 'melody', velocity: .6,
    timbre: 'strings', articulation: 'connected', expression: { role: sourceId.includes('ornament') ? 'ornament' : 'anchor', sourceId },
  });
  frame.tick = 0; frame.duration = PPQ * 4; frame.sound.tuning = '24edo'; frame.phrase = undefined;
  frame.notes = [note('one', 0, PPQ * 3, 0), note('two', PPQ, PPQ / 2, 1, 'core:ornament:trill:0:0'),
    note('three', PPQ * 2, PPQ * 2, -1), { id: 'ref', tick: PPQ, duration: 80, voice: 9, part: 'percussion', midiNote: 42,
      velocity: .5, expression: { role: 'anchor', sourceId: 'reference:quarter' } }];
  const report = capabilityScoreSummary([frame]);
  assert.equal(report.lead.attacks, 3);
  assert.deepEqual(report.lead.stepCents, [50, -100]);
  assert.equal(report.lead.directionChanges, 1);
  assert.equal(report.lead.ornamentEvents, 1); assert.deepEqual(report.lead.ornamentKinds, { trill: 1 });
  assert.equal(report.tuning.fractionalMidiAttacks, 2); assert.equal(report.tuning.offNativeGridAttacks, 0);
  // The first three-beat note is replaced after one beat, not counted as a long hold.
  assert.equal(report.parts.melody.gatesAtLeastTwoBeats, 1);
  assert.equal(report.parts.melody.sourceGateBeats.median, 1);
  assert.equal(report.rhythm.referencePercussionEvents, 1); assert.equal(report.rhythm.referenceOffQuarterGrid, 0);
  assert.equal(report.noteEvents, report.uniqueEventIds);
  frame.notes[1].absolutePitch!.millicents += 1100;
  assert.equal(capabilityScoreSummary([frame]).tuning.offNativeGridAttacks, 1);
});

test('six real studies replay serialized inputs and expose complete arguments on their native grids', async () => {
  for (const item of capabilityCases('glass-garden')) {
    const saved = structuredClone(item.recipe), progress: string[] = [];
    const passage = await generateCapabilityStudy(item.recipe, message => progress.push(message));
    const report = capabilityScoreSummary(passage.frames);
    assert.deepEqual(item.recipe, saved);
    assert.ok(passage.exactReplay, item.id);
    assert.ok(report.beats >= 16 && report.beats <= 96, `${item.id}: bounded whole argument`);
    assert.ok(report.arguments.length > 0 && report.arguments.every(argument => argument.completeWithinExcerpt), item.id);
    assert.ok(report.arguments.every(argument => argument.realization?.contour && argument.realization.rhythmSourceId), `${item.id}: actual realization metadata`);
    for (const argument of report.arguments) for (const clause of argument.realization?.clauses ?? []) {
      assert.ok(clause.endTick > clause.startTick && clause.startTick >= argument.startTick && clause.endTick <= argument.endTick);
      assert.ok(clause.operation && clause.rhythmFamily);
    }
    assert.equal(report.noteEvents, report.uniqueEventIds, `${item.id}: event identities`);
    assert.equal(report.tuning.offNativeGridAttacks, 0, `${item.id}: native pitch grid`);
    if (item.recipe.sound.tuning !== '12tet') assert.ok(report.tuning.fractionalMidiAttacks > 0, `${item.id}: actual non-semitone notes`);
    assert.equal(report.rhythm.referenceOffQuarterGrid, 0, `${item.id}: steady reference phase`);
    assert.ok(report.lead.attacks > 0 && report.lead.onsetGapBeats.median > 0);
    assert.ok(progress.some(message => message.startsWith('Composing')) && progress.some(message => message.startsWith('Replaying')));
  }
});

test('later-argument score cohort verifies emitted native ornament sources without substituting audio windows', async () => {
  const kinds = new Set<string>(); let ornamentEvents = 0;
  for (const item of capabilityCases('glass-garden')) {
    const cohort = await capabilityArgumentCohort(item.recipe);
    assert.equal(cohort.arguments.length, 4);
    for (const argument of cohort.arguments) {
      assert.ok(argument.complete && argument.leadAttacks > 0);
      assert.equal(argument.offNativeGridAttacks, 0);
      assert.ok(argument.endTick > argument.startTick);
      assert.equal(argument.ornamentEvents, Object.values(argument.ornamentKinds).reduce((a, b) => a + b, 0));
      assert.ok(argument.ornamentSourceIds.every(source => source.includes(':ornament:')));
    }
    ornamentEvents += cohort.ornamentEvents; cohort.ornamentKinds.forEach(kind => kinds.add(kind));
  }
  assert.ok(ornamentEvents > 0 && kinds.size > 0, 'At least one genuine production ornament must appear across24 complete study arguments.');
});
