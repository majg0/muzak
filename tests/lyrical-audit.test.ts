import test from 'node:test';
import assert from 'node:assert/strict';
import { lyricalScoreSummary, selectLyricalArgument, lyricalCadenceMeasurements } from '../src/lyrical-audit';
import { degreeToPitch } from '../src/pitch';
import { createPerformance } from '../src/serialization';
import { lyricalPerformance } from '../src/lyrical';
import { MusicEngine } from '../src/engine';
import type { Frame, NoteEvent } from '../src/types';

test('lyrical note measurements retain native pitch distances and distinguish connections from written breaths', () => {
  const notes: NoteEvent[] = [
    { tick: 0, duration: 984, degree: 0 },
    { tick: 960, duration: 480, degree: 3 },
    { tick: 1680, duration: 1440, degree: 5 },
  ].map((source, index) => ({ id: `lyrical/${index}`, tick: source.tick, duration: source.duration, absolutePitch: degreeToPitch('19edo', source.degree),
    part: 'melody', voice: 5, velocity: .7, timbre: 'strings', articulation: 'sustained' }));
  const frames = [{ notes: [...notes, { ...notes[0], id: 'unrelated-counter', voice: 8 }], tick: 0, duration: 3840 } as Frame];
  const result = lyricalScoreSummary(frames, 0, 3840);
  assert.equal(result.notes, 3); assert.equal(result.connectedBoundaries, 1); assert.equal(result.writtenBreaths, 1);
  assert.equal(result.longestBreathBeats, .5); assert.equal(result.longestGateBeats, 3);
  assert.equal(result.medianOnsetSpacingBeats, 2); assert.equal(result.cadenceNote?.durationBeats, 3);
  assert.ok(Math.abs(result.rangeCents - 5 * 1200 / 19) < .001, 'Native 19-EDO intervals remain physical cents instead of MIDI rounding.');
  assert.deepEqual(result.timbres, ['strings']); assert.equal(result.articulationCounts.sustained, 3);
  assert.equal(lyricalScoreSummary(frames, 960, 1680).notes, 1, 'The selected theme interval excludes other phrase attacks.');
});

test('the production lyrical audition includes every open inner sentence before the authored closed cadence', () => {
  let heardOpenSentences = 0;
  for (const [seed, tuning] of [['glass-garden', '12tet'], ['velvet-orbit', '12tet'], ['amber-current', '19edo']] as const) {
    const source = createPerformance(seed);
    if (tuning === '19edo') source.sound = { ...source.sound, tuning, instrument: 'additive' };
    const recipe = lyricalPerformance(source, seed).recipe;
    const engine = new MusicEngine({ seed, parameters: recipe.initialParameters, conductor: recipe.conductor, phrasing: recipe.phrasing, sound: recipe.sound });
    const frames: Frame[] = []; let argument: ReturnType<typeof selectLyricalArgument>;
    for (let i = 0; i < 160; i++) {
      const frame = engine.step(); frames.push(frame); argument ??= selectLyricalArgument(frames);
      if (argument && frame.tick + frame.duration >= argument.last.endTick) break;
    }
    assert.ok(argument, `${seed} has a bounded complete argument.`);
    assert.ok(argument.sentences.length >= 1);
    for (const sentence of argument.sentences) {
      assert.ok(sentence.endTick - sentence.startTick <= argument.contextBar * 16, 'Spacious complete arguments can span sixteen true bars.');
      assert.ok(sentence.cells.some(cell => cell.label.startsWith('Question'))
        && sentence.cells.some(cell => cell.label.startsWith('Answer')), 'One long sentence still contains both halves of the thematic argument.');
    }
    assert.ok(argument.sentences.slice(0, -1).every(sentence => sentence.composition?.cadence === 'open'));
    assert.equal(argument.last.composition?.cadence, 'closed');
    if (argument.first.composition?.cadence === 'open') {
      heardOpenSentences += argument.sentences.length - 1;
      assert.equal(selectLyricalArgument(frames.filter(frame => frame.tick < argument!.first.endTick)), undefined, 'An open first sentence is insufficient to end the audition.');
    }
    const endings = lyricalCadenceMeasurements(frames, recipe, argument.sentences);
    assert.ok(endings.every(ending => ending.matchesAuthoredEnding), JSON.stringify(endings));
    assert.equal(endings.at(-1)!.plannedEndingDegree, 0); assert.equal(endings.at(-1)!.heldFinalBeats, endings.at(-1)!.plannedFinalBeats);
    assert.ok(endings.slice(0, -1).every(ending => [2, 4].includes(((ending.plannedEndingDegree % 7) + 7) % 7)));
  }
  assert.ok(heardOpenSentences > 0, 'The production fixtures exercise an open argument followed by its actual closing answer.');
});
