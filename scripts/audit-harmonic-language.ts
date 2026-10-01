import { writeFileSync } from 'node:fs';
import { MusicEngine, eventHash } from '../src/engine';
import { createPerformance, parsePerformance, serializePerformance } from '../src/serialization';
import { lyricalPerformance } from '../src/lyrical';
import { ENGINE_VERSION, type Frame } from '../src/types';
import { pitchToDegree, degreeToPitch } from '../src/pitch';

const cases = [];
for (const seed of ['glass-garden', 'velvet-orbit', 'amber-current']) for (const tuning of ['12tet', '19edo'] as const) {
  const recipe = lyricalPerformance(createPerformance(seed)).recipe; recipe.sound.tuning = tuning;
  if (tuning === '19edo') recipe.sound.instrument = 'additive';
  const serialized = parsePerformance(serializePerformance(recipe));
  const engine = new MusicEngine({ ...recipe, parameters: recipe.initialParameters });
  const replay = new MusicEngine({ ...serialized, parameters: serialized.initialParameters });
  const frames: Frame[] = [], timings: number[] = [];
  let exactReplay = true;
  for (let index = 0; index < 256; index++) {
    const before = performance.now(), frame = engine.step(); timings.push(performance.now() - before); frames.push(frame);
    exactReplay &&= eventHash(frame) === eventHash(replay.step());
  }
  const changing = frames.filter(frame => frame.tick === frame.diagnostics.harmonicPlan!.current.startTick);
  const moves = changing.slice(1).map(frame => frame.voicePitches.map((pitch, voice) => Math.abs(pitch.millicents - frames[frame.index - 1].voicePitches[voice].millicents) / 1000));
  const notes = frames.flatMap(frame => frame.notes), lead = notes.filter(note => note.part === 'melody');
  const core = [...new Map(frames.map(frame => [frame.phrase!.startTick, frame.phrase!.themeCore!])).values()];
  const native = notes.filter(note => note.part !== 'percussion').every(note => degreeToPitch(tuning, pitchToDegree(tuning, note.absolutePitch!)).millicents === note.absolutePitch!.millicents);
  const sorted = timings.slice(8).sort((a, b) => a - b);
  const summary = { seed, tuning, eventHash: eventHash(notes), exactReplay, native,
    destinationCount: changing.length, realizedDestinations: changing.filter(frame => frame.diagnostics.harmonicPlan!.realization.matched).length,
    distinctRoots: new Set(changing.map(frame => frame.diagnostics.harmonicPlan!.current.root)).size,
    harmonicChangesMovingMultipleVoices: moves.filter(movement => movement.filter(value => value > .001).length >= 2).length,
    meanUpperMovementCents: moves.flat().reduce((a, b) => a + b, 0) / moves.flat().length,
    maxUpperMovementCents: Math.max(...moves.flat()),
    themeGrammars: [...new Set(core.map(item => item.grammar))], coreIds: [...new Set(core.map(item => item.id))],
    cadences: [...new Set(changing.map(frame => frame.diagnostics.harmonicPlan!.current.cadence).filter(Boolean))],
    leadNotes: lead.length, longNotesFraction: lead.filter(note => note.duration >= 480).length / lead.length,
    meanPlanningMs: sorted.reduce((a, b) => a + b, 0) / sorted.length, p95PlanningMs: sorted[Math.floor(sorted.length * .95)], maxPlanningMs: Math.max(...timings),
  };
  cases.push(summary); console.log(JSON.stringify(summary));
}
const report = { engineVersion: ENGINE_VERSION, cases, method: 'Symbolic and timing measurements, not a listening verdict. Upper motion is measured at harmonic changes, excluding initialization. Native constraints and whole-frame replay are checked.' };
writeFileSync('harmonic-language-audit.json', JSON.stringify(report, null, 2));
if (cases.some(item => !item.exactReplay || !item.native || item.realizedDestinations !== item.destinationCount)) process.exitCode = 1;
