import test from 'node:test';
import assert from 'node:assert/strict';
import { planTransitions } from '../src/engine/transitions';
import { thematicCell } from '../src/engine/idea-kernel';
import { DEFAULT_PARAMETERS } from '../src/parameters';
import { MusicEngine } from '../src/engine';
import { createPerformance } from '../src/serialization';
import { MANUAL_CONDUCTOR } from '../src/conductor';
import { pitchToDegree, TUNINGS, type TuningId } from '../src/pitch';

const p = { ...DEFAULT_PARAMETERS, rhythmicDensity: .95, rhythmicComplexity: .95,
  rhythmicPredictability: .2, bassMobility: .85, dynamics: .75 };

test('boundary fills subdivide the shared source into many actual deliveries, with anchored arrivals and directed density', () => {
  const fingerprints = new Set<string>();
  let early = 0, late = 0;
  for (let index = 0; index < 24; index++) {
    const seed = `generated-fill-${index}`, themeId = `theme-${index % 4}`;
    const boundary = { id: 'next-section', themeId, tick: 9600, kind: 'section' as const };
    const plan = planTransitions(seed, [boundary], p, 1)[0];
    assert.equal(plan.sourceId, thematicCell(seed, themeId).id);
    const preparation = plan.notes.filter(note => note.tick < boundary.tick);
    assert.ok(preparation.length >= 8 && preparation.length <= 36);
    assert.ok(plan.hierarchy && plan.hierarchy.length === preparation.length);
    assert.ok(preparation.every(note => [36, 38, 42].includes(note.midiNote!) && note.duration > 0
      && Number.isSafeInteger(note.tick) && Number.isSafeInteger(note.duration)
      && note.tick + note.duration <= plan.rests[0].startTick));
    assert.ok(plan.notes.some(note => note.tick === boundary.tick && note.midiNote === 36));
    const midpoint = (plan.startTick + plan.rests[0].startTick) / 2;
    early += preparation.filter(note => note.tick < midpoint).length;
    late += preparation.filter(note => note.tick >= midpoint).length;
    fingerprints.add(preparation.map(note => `${note.tick - boundary.tick}:${note.midiNote}`).join(','));
    assert.deepEqual(planTransitions(seed, [boundary], p, 1)[0], plan);
  }
  assert.ok(fingerprints.size >= 20, 'Generated sources yield actual timing/instrument differences, not renamed versions of a fixed roll.');
  assert.ok(late > early * 1.7, 'Attack budget gathers toward the destination rather than filling every beat at equal density.');
});

test('cached transition plans retain all dependencies and the source landmarks in different invocation orders', () => {
  const boundary = { id: 'same-boundary', themeId: 'theme-a', tick: 7680, kind: 'meter' as const };
  const first = planTransitions('source-cache', [boundary], p, .8);
  const other = planTransitions('source-cache', [{ ...boundary, themeId: 'theme-b' }], p, .8);
  planTransitions('source-cache', [{ ...boundary, tick: 7681 }], { ...p, rhythmicPredictability: 1 }, .6);
  assert.deepEqual(planTransitions('source-cache', [boundary], p, .8), first);
  assert.notDeepEqual(other[0].hierarchy, first[0].hierarchy);
  const cell = thematicCell('source-cache', boundary.themeId), plan = first[0], end = plan.rests[0].startTick;
  for (let origin = boundary.tick - cell.units * 120; origin + cell.units * 120 > plan.startTick; origin -= cell.units * 120)
    for (const attack of cell.attacks) {
      const tick = origin + attack.unit * 120;
      if (tick >= plan.startTick && tick < end) assert.ok(plan.hierarchy!.some(note => note.tick === tick && note.level === 'goal'));
    }
});

test('full production realization retains non-root bass figures, a clear drum reference and exact native pitches', () => {
  for (const tuning of Object.keys(TUNINGS) as TuningId[]) {
    const recipe = createPerformance('grounded-chordal-bass');
    recipe.initialParameters = { ...recipe.initialParameters, ...p, melodicActivity: .8, rhythmicDensity: .7,
      ideaDensity: .6, ensembleSize: .8 };
    recipe.conductor = { ...MANUAL_CONDUCTOR };
    recipe.phrasing!.composition!.dynamicRange = 0;
    recipe.sound = { ...recipe.sound!, tuning };
    const engine = new MusicEngine({ seed: recipe.seed, parameters: recipe.initialParameters,
      conductor: recipe.conductor, phrasing: recipe.phrasing, sound: recipe.sound });
    const frames = Array.from({ length: 48 }, () => engine.step());
    const divisions = TUNINGS[tuning].divisions, mod = (value: number) => (value % divisions + divisions) % divisions;
    let bassCount = 0, chordalAnswers = 0, reference = 0;
    for (const frame of frames) for (const note of frame.notes) {
      if (note.part === 'percussion' && note.expression?.sourceId === 'reference:quarter') reference++;
      if (note.part !== 'bass') continue;
      bassCount++;
      const degree = pitchToDegree(tuning, note.absolutePitch!);
      if (mod(degree) !== mod(pitchToDegree(tuning, frame.bassPitch))) chordalAnswers++;
      assert.ok(note.absolutePitch!.millicents >= 2800000 && note.absolutePitch!.millicents <= 5200000);
      assert.ok(Math.abs(note.absolutePitch!.millicents - (6900000 + degree * 1200000 / divisions)) <= 1);
    }
    assert.ok(bassCount > 20 && chordalAnswers / bassCount > .18, `${tuning}: actual emitted bass lost its non-root chordal answers (${chordalAnswers}/${bassCount}).`);
    assert.ok(reference > 30, 'The final ensemble must retain actual timekeeping strikes, not only score opportunities.');
  }
});
