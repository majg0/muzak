import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_COMPOSITION } from '../src/composition';
import { MANUAL_CONDUCTOR } from '../src/conductor';
import { MusicEngine } from '../src/engine';
import { createPerformance, decodeShareState, encodeShareState, parsePerformance, scheduleParameterTransition, serializePerformance } from '../src/serialization';
import { FRAME_TICKS, type AutomationLane, type Frame, type Performance } from '../src/types';

function recipe(): Performance {
  const performance = createPerformance('tempo-window');
  performance.conductor = { ...MANUAL_CONDUCTOR };
  performance.initialParameters = { ...performance.initialParameters, tempo: 84,
    rhythmicDensity: .75, rhythmicComplexity: .9, rhythmicPredictability: 1 };
  performance.phrasing!.composition = { ...DEFAULT_COMPOSITION,
    displacement: .83, polymeter: .69, transition: 1 };
  return performance;
}

const engine = (performance: Performance) => new MusicEngine({
  seed: performance.seed, parameters: performance.initialParameters,
  conductor: performance.conductor, phrasing: performance.phrasing, sound: performance.sound,
  weights: performance.weights, automation: performance.automation,
  automationRevisions: performance.automationRevisions,
});
const tempoLane = (points: Array<[number, number]>): AutomationLane => ({ parameter: 'tempo',
  points: points.map(([tick, value]) => ({ tick, value, curve: 'step' })) });
const tempoNotes = (frames: Frame[]) => frames.flatMap(frame => frame.notes)
  .filter(note => note.id.startsWith('transition:tempo-'));

test('known tempo preparation lands at the frame that actually receives an off-grid keyframe', () => {
  const performance = recipe(), keyframeTick = 5501, boundary = FRAME_TICKS * 6;
  performance.automation = [tempoLane([[0, 84], [keyframeTick, 120]])];
  const composer = engine(performance);
  const frames = Array.from({ length: 8 }, () => composer.step());
  assert.ok(frames.filter(frame => frame.tick < boundary).every(frame => frame.parameters.tempo === 84));
  assert.ok(frames.filter(frame => frame.tick >= boundary).every(frame => frame.parameters.tempo === 120));
  const preparation = tempoNotes(frames);
  assert.ok(preparation.some(note => note.tick < keyframeTick), 'A destination known at the origin gets musical preparation.');
  // A shared phrase accent may merge the arrival into an ensemble strike.
  // Check the sounding onset and retained provenance, not only its outer ID.
  assert.ok(frames.flatMap(frame => frame.notes).some(note => note.tick === boundary && note.part === 'percussion'
    && note.midiNote === 36 && (note.id.startsWith('transition:tempo-') || note.expression?.sourceId?.startsWith('transition:tempo-'))),
  'The arrival shares the actual BPM commit.');
  assert.ok(preparation.every(note => note.id.startsWith(`transition:tempo-${boundary}:`)));
  assert.ok(frames.some(frame => frame.phrase?.rests.some(rest => rest.scope === 'accompaniment' && rest.endTick === boundary)));
  const snapshots = frames.map(frame => frame.phrase?.composition?.transition).filter(snapshot => snapshot?.reason === 'tempo');
  assert.ok(snapshots.length >= 3);
  assert.ok(snapshots.every(snapshot => snapshot!.boundaryTick === boundary && snapshot!.kind === 'roll'));
  assert.ok(snapshots.every(snapshot => JSON.stringify(snapshot) === JSON.stringify(snapshots[0])), 'The same known destination retains its preparation plan across frames.');
});

test('future automation knowledge cannot add preparation to earlier frames, and the complete recorded config replays', () => {
  let performance = recipe();
  const live = engine(performance), baseline = engine(performance);
  const knownAtTick = FRAME_TICKS * 5, rawDestination = knownAtTick + 701;
  const committed = Array.from({ length: 5 }, () => live.step());
  assert.deepEqual(committed, Array.from({ length: 5 }, () => baseline.step()));
  assert.equal(tempoNotes(committed).length, 0);
  performance = scheduleParameterTransition(performance, 'tempo', knownAtTick, rawDestination, 120, 'step', knownAtTick);
  assert.deepEqual(performance.automationRevisions?.map(revision => revision.tick), [0, knownAtTick]);
  live.setAutomation(performance.automation, performance.automationRevisions);
  committed.push(...Array.from({ length: 17 }, () => live.step()));
  assert.ok(tempoNotes(committed).length > 0);
  assert.ok(tempoNotes(committed).every(note => note.tick >= knownAtTick), 'A late announcement starts only in uncommitted material.');

  const restored = parsePerformance(serializePerformance(performance));
  assert.deepEqual(restored, performance);
  assert.deepEqual(decodeShareState(encodeShareState(performance)), performance);
  assert.deepEqual(restored.phrasing!.composition, performance.phrasing!.composition);
  const replay = engine(restored);
  assert.deepEqual(Array.from({ length: committed.length }, () => replay.step()), committed);

  // This deliberately different recipe knows the same destination from time
  // zero, proving that the revision assertion exercises a real look-ahead effect.
  const knownFromOrigin = structuredClone(restored);
  delete knownFromOrigin.automationRevisions;
  const announced = engine(knownFromOrigin);
  assert.ok(tempoNotes(Array.from({ length: 5 }, () => announced.step())).some(note => note.tick < knownAtTick));
});

test('nearby tempo destinations remain stable through a simultaneous section boundary', () => {
  const performance = recipe(), first = FRAME_TICKS * 16, second = FRAME_TICKS * 18;
  performance.automation = [tempoLane([[0, 84], [first - 131, 118], [second - 211, 96]])];
  const composer = engine(performance);
  const frames = Array.from({ length: 20 }, () => composer.step());
  const snapshots = frames.flatMap(frame => frame.phrase?.composition?.transition ? [frame.phrase.composition.transition] : []);
  for (const boundary of [first, second]) {
    const related = snapshots.filter(snapshot => snapshot.boundaryTick === boundary);
    assert.ok(related.length >= 2, `Destination ${boundary} is shown in several frames.`);
    assert.ok(related.every(snapshot => snapshot.reason === 'tempo'), 'A tempo destination takes precedence over a coincident section arrival.');
    assert.ok(related.every(snapshot => JSON.stringify(snapshot) === JSON.stringify(related[0])));
  }
  assert.ok(snapshots.filter(snapshot => snapshot.boundaryTick === second).every(snapshot => snapshot.startTick >= first));
  const notes = tempoNotes(frames);
  // Ensemble coordination may merge an arrival with an identical structural
  // strike; the percussion onset must survive even if its source ID changes.
  for (const boundary of [first, second]) assert.ok(frames.flatMap(frame => frame.notes)
    .some(note => note.tick === boundary && note.part === 'percussion' && note.midiNote === 36));
  assert.equal(new Set(notes.map(note => note.id)).size, notes.length);
  assert.equal(frames[first / FRAME_TICKS].parameters.tempo, 118);
  assert.equal(frames[second / FRAME_TICKS].parameters.tempo, 96);
});

test('unsampled transient tempo points do not announce a change that playback never receives', () => {
  const performance = recipe();
  performance.automation = [tempoLane([[0, 84], [1050, 120], [1100, 84]])];
  const composer = engine(performance);
  const frames = Array.from({ length: 4 }, () => composer.step());
  assert.ok(frames.every(frame => frame.parameters.tempo === 84));
  assert.equal(tempoNotes(frames).length, 0);
  assert.ok(frames.every(frame => frame.phrase?.composition?.transition?.reason !== 'tempo'));
});
