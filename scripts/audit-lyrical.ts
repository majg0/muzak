import { writeFile } from 'node:fs/promises';
import { MusicEngine, eventHash } from '../src/engine';
import { lyricalPerformance } from '../src/lyrical';
import { lyricalScoreSummary } from '../src/lyrical-audit';
import { createPerformance, parsePerformance, serializePerformance } from '../src/serialization';
import { lyricalHarmonyWindow } from '../src/engine/lyrical-support';
import { ENGINE_VERSION } from '../src/types';

const cases = [];
for (const seed of ['glass-garden', 'velvet-orbit', 'amber-tide']) for (const tuning of ['12tet', '19edo'] as const) {
  const { recipe } = lyricalPerformance(createPerformance(seed));
  recipe.sound.tuning = tuning;
  if (tuning === '19edo') recipe.sound.instrument = 'additive';
  const composer = new MusicEngine({ ...recipe, parameters: recipe.initialParameters });
  const timings: number[] = [];
  const frames = Array.from({ length: 256 }, () => {
    const start = performance.now(), frame = composer.step();
    timings.push(performance.now() - start);
    return frame;
  });
  const restored = parsePerformance(serializePerformance(recipe));
  const replay = new MusicEngine({ ...restored, parameters: restored.initialParameters });
  const notes = frames.flatMap(frame => frame.notes);
  const expected = eventHash(notes), actual = eventHash(frames.flatMap(() => replay.step().notes));
  const changes = frames.slice(1).filter((frame, index) => frame.voicePitches.some((pitch, voice) => pitch.millicents !== frames[index].voicePitches[voice].millicents)
    || frame.bassPitch.millicents !== frames[index].bassPitch.millicents);
  const maxMotionCents = Math.max(...frames.slice(1).flatMap((frame, index) => frame.voicePitches.map((pitch, voice) => Math.abs(pitch.millicents - frames[index].voicePitches[voice].millicents) / 1000)));
  const motionAtChanges = changes.flatMap(frame => frame.voicePitches.map((pitch, voice) => Math.abs(pitch.millicents - frames[frame.index - 1].voicePitches[voice].millicents) / 1000));
  const meanMotionAtChanges = motionAtChanges.reduce((sum, value) => sum + value, 0) / Math.max(1, motionAtChanges.length);
  const first = frames.find(frame => frame.form?.role === 'theme' && frame.phrase?.cells.some(cell => cell.label.startsWith('Question')))!;
  const sentence = first.phrase!;
  const score = lyricalScoreSummary(frames, sentence.startTick, sentence.endTick);
  const times = [...timings.slice(8)].sort((a, b) => a - b);
  const checks = { exactReplay: expected === actual, wholeSentence: sentence.endTick > sentence.startTick && score.notes >= 8,
    longNotes: score.notesAtLeastOneBeat >= score.notes * .5 && score.longestGateBeats >= 2,
    structuralHarmony: changes.every(frame => frame.tick === (frame.diagnostics.harmonicPlan?.current.startTick ?? lyricalHarmonyWindow(frame.form!).startTick)),
    smoothUpperVoices: recipe.phrasing?.harmony ? meanMotionAtChanges <= 150 && maxMotionCents <= 700.001 : maxMotionCents <= 200.001,
    declaredDestinations: frames.every(frame => !frame.diagnostics.harmonicPlan || frame.diagnostics.harmonicPlan.realization.matched),
    primaryMelody: notes.filter(note => note.part === 'melody').every(note => note.voice === 5),
    nativeMicrotones: tuning === '12tet' || notes.some(note => note.part === 'melody' && note.absolutePitch!.millicents % 100000 !== 0) };
  cases.push({ seed, tuning, passed: Object.values(checks).every(Boolean), checks, eventHash: expected,
    frames: frames.length, harmonyChanges: changes.length, maxMotionCents, meanMotionAtChanges,
    firstSentenceCadence: sentence.composition?.cadence, score,
    planningMs: { mean: timings.reduce((sum, value) => sum + value, 0) / timings.length, p95: times[Math.floor(times.length * .95)], max: times.at(-1) } });
}
const report = { engineVersion: ENGINE_VERSION, passed: cases.every(item => item.passed), cases,
  limitation: 'Symbolic motion, phrase spacing, hierarchy and deterministic replay only. These measurements do not establish musical beauty or a subjective listening assessment.' };
await writeFile(new URL('../lyrical-audit.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;
