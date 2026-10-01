import { writeFileSync } from 'node:fs';
import { performance as clock } from 'node:perf_hooks';
import { MusicEngine } from '../src/engine';
import { lyricalPerformance } from '../src/lyrical';
import { createPerformance } from '../src/serialization';
import { lyricalScoreSummary } from '../src/lyrical-audit';
import { melodySupport12, melodySupport19 } from '../src/engine/melody-support';
import { pitchToDegree, type Pitch, type TuningId } from '../src/pitch';
import { ENGINE_VERSION, type Frame, type NoteEvent, type Performance } from '../src/types';

const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
const q = (n: number) => Math.round(n * 1e4) / 1e4;
const quantile = (values: number[], fraction: number) => [...values].sort((a, b) => a - b)[Math.floor((values.length - 1) * fraction)] ?? 0;
const lead = (note: NoteEvent) => note.part === 'melody' && (note.voice === 5 || note.voice === 6);
const mod = (value: number, period: number) => ((value % period) + period) % period;
const make = (p: Performance) => new MusicEngine({ seed: p.seed, parameters: p.initialParameters, sound: p.sound,
  conductor: p.conductor, phrasing: p.phrasing, automation: p.automation, automationRevisions: p.automationRevisions, weights: p.weights });

function analyze(frames: Frame[], from: number, to: number, tuning: TuningId) {
  const all = frames.flatMap(frame => frame.notes).sort((a, b) => a.tick - b.tick || a.voice - b.voice);
  const melody = all.filter(note => lead(note) && note.tick >= from && note.tick < to);
  const bed = all.filter(note => note.part === 'harmony' || note.part === 'bass');
  const contextAt = (tick: number) => {
    const latest = new Map<number, NoteEvent>();
    for (const note of bed) { if (note.tick > tick) break; latest.set(note.voice, note); }
    const pitchAt = (note: NoteEvent): Pitch => note.endPitch && note.glideTicks ? { millicents: Math.round(note.absolutePitch!.millicents
      + (note.endPitch.millicents - note.absolutePitch!.millicents) * Math.min(1, (tick - note.tick) / note.glideTicks)) } : note.absolutePitch!;
    const sounding = [...latest.values()].filter(note => note.tick + note.duration > tick);
    return { upper: sounding.filter(note => note.part === 'harmony').map(pitchAt), bass: sounding.find(note => note.part === 'bass') };
  };
  const cues = [...new Map(frames.flatMap(frame => frame.phrase?.composition?.cues ?? []).map(cue => [cue.id, cue])).values()];
  const samples = melody.map(note => {
    const at = note.tick + Math.min(120, Math.floor(note.duration / 2)), context = contextAt(at);
    const melodyCents = note.absolutePitch!.millicents / 1000;
    const bass = context.bass?.absolutePitch;
    const interval = bass ? mod(melodyCents - bass.millicents / 1000, 1200) : null;
    const distances = context.upper.map(pitch => Math.abs(pitch.millicents / 1000 - melodyCents));
    const support = !bass || !context.upper.length ? null : tuning === '12tet'
      ? melodySupport12(context.upper.map(pitch => pitch.millicents / 100000), bass.millicents / 100000, [melodyCents])
      : melodySupport19(context.upper.map(pitch => pitchToDegree('19edo', pitch)), pitchToDegree('19edo', bass), [melodyCents]);
    const cadence = cues.find(cue => cue.id === note.expression?.cueId && cue.id.endsWith(':resolution'));
    return { tick: note.tick, durationBeats: q(note.duration / 480), pitchCents: melodyCents,
      bassIntervalCents: interval === null ? null : q(interval), upperCents: context.upper.map(pitch => pitch.millicents / 1000),
      support, closeUpperNeighbor: distances.some(distance => distance > 35 && distance < 160),
      upperMissing: context.upper.length !== 4, bassMissing: !bass,
      closedCadence: Boolean(cadence && cadence.strength >= .9), cadence: Boolean(cadence), sourceId: note.expression?.sourceId };
  });
  const strong = samples.filter(note => note.durationBeats >= 2 || note.cadence || cues.some(cue => cue.tick === note.tick && cue.id.endsWith(':high-point')));
  const cadence = samples.filter(note => note.cadence);
  const collections = frames.filter(frame => frame.tick >= from && frame.tick < to).map(frame => `${frame.voicePitches.map(pitch => pitch.millicents).join(',')}/${frame.bassPitch.millicents}`);
  const harmonicFrames = frames.filter(frame => frame.tick >= from && frame.tick < to);
  const degreeClass = (pitch: Pitch) => mod(pitchToDegree(tuning, pitch), tuning === '12tet' ? 12 : 19);
  const pitchCollections = harmonicFrames.map(frame => [...new Set([...frame.voicePitches, frame.bassPitch].map(degreeClass))].sort((a, b) => a - b));
  const gaps = melody.slice(1).map((note, index) => note.tick - melody[index].tick - melody[index].duration);
  return { startTick: from, endTick: to, ...lyricalScoreSummary(frames, from, to),
    harmony: { distinctSonorities: new Set(collections).size, chordChanges: collections.slice(1).filter((value, index) => value !== collections[index]).length,
      distinctPitchCollections: new Set(pitchCollections.map(collection => collection.join(','))).size,
      distinctBassClasses: new Set(harmonicFrames.map(frame => degreeClass(frame.bassPitch))).size,
      pitchClassesPerSonority: [Math.min(...pitchCollections.map(collection => collection.length)), Math.max(...pitchCollections.map(collection => collection.length))],
      attacks: all.filter(note => note.part === 'harmony' && note.tick >= from && note.tick < to).length,
      minimumGateBeats: q(Math.min(...all.filter(note => note.part === 'harmony' && note.tick >= from && note.tick < to).map(note => note.duration / 480))) },
    strongNotes: strong.length, meanHeldSupport: q(mean(strong.flatMap(note => note.support === null ? [] : [note.support]))),
    heldCloseUpperNeighbors: strong.filter(note => note.closeUpperNeighbor).length,
    maximumLeadOverlapTicks: Math.max(0, ...gaps.map(value => -value)), maximumLeadGapTicks: Math.max(0, ...gaps),
    missingBedAtMelodyAttacks: samples.filter(note => note.upperMissing || note.bassMissing).length,
    otherForegroundAttacks: all.filter(note => note.part === 'melody' && !lead(note) && note.tick >= from && note.tick < to).length,
    cadences: cadence, weakestHeldNotes: [...strong].sort((a, b) => (a.support ?? 0) - (b.support ?? 0)).slice(0, 5) };
}

const cases = [];
for (const seed of ['glass-garden', 'velvet-orbit', 'amber-current']) for (const tuning of ['12tet', '19edo'] as const) {
  const recipe = lyricalPerformance(createPerformance(seed), seed).recipe;
  recipe.sound.tuning = tuning;
  if (tuning === '19edo') recipe.sound.instrument = 'additive';
  const warm = make(recipe); for (let i = 0; i < 16; i++) warm.step();
  const engine = make(recipe), frames: Frame[] = [], timings: number[] = [];
  for (let index = 0; index < 320; index++) {
    const start = clock.now(); frames.push(engine.step()); const elapsed = clock.now() - start;
    if (index >= 32) timings.push(elapsed);
  }
  const first = frames[0].phrase!;
  const theme = frames.find(frame => frame.form?.role === 'theme')!.form!;
  cases.push({ seed, tuning, firstSentence: analyze(frames, first.startTick, first.endTick, tuning),
    firstTheme: analyze(frames, theme.sectionStartTick, theme.sectionEndTick, tuning),
    planningMilliseconds: { samples: timings.length, mean: q(mean(timings)), p95: q(quantile(timings, .95)), maximum: q(Math.max(...timings)) } });
}
const report = { engineVersion: ENGINE_VERSION,
  method: 'Production Lyrical score recipe; native19 uses additive sound as required. Actual emitted note durations and audible held-note history sampled120ticks after attack, excluding synthesis entrance glides. Twelve-tone arrangement support and native19 open-spacing support have different meanings and are not cross-tuning consonance scales. Timing samples exclude the first32frames after a separate16frame warm-up. No subjective listening claim.', cases };
writeFileSync('lyrical-support-audit.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(cases.map(item => ({ seed: item.seed, tuning: item.tuning, firstSentence: {
  notes: item.firstSentence.notes, medianGate: item.firstSentence.medianGateBeats, sonorities: item.firstSentence.harmony.distinctSonorities,
  support: item.firstSentence.meanHeldSupport, closeHeldNeighbors: item.firstSentence.heldCloseUpperNeighbors,
  cadences: item.firstSentence.cadences.map(note => ({ closed: note.closedCadence, bassCents: note.bassIntervalCents, support: note.support })) },
  firstTheme: { sonorities: item.firstTheme.harmony.distinctSonorities, support: item.firstTheme.meanHeldSupport,
    closeHeldNeighbors: item.firstTheme.heldCloseUpperNeighbors, cadences: item.firstTheme.cadences.map(note => ({ closed: note.closedCadence, bassCents: note.bassIntervalCents, support: note.support })) },
  timings: item.planningMilliseconds })), null, 2));
