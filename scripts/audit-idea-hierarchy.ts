import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { MusicEngine, eventHash } from '../src/engine';
import { createPerformance, parsePerformance, serializePerformance } from '../src/serialization';
import { explorationPerformance } from '../src/exploration';
import { ENGINE_VERSION, type Frame } from '../src/types';

const sources = ['idea-kernel', 'theme-core', 'lyrical', 'phrase', 'rhythmic-score', 'groove', 'ensemble-fill', 'transitions', 'expressive-glides', 'index']
  .map(name => `src/engine/${name}.ts`).concat(['src/conductor.ts']);
const sourceHashes = () => Object.fromEntries(sources.map(file => [file, createHash('sha256').update(readFileSync(file)).digest('hex')]));
const before = sourceHashes();
const cases = [];
for (const seed of ['glass-garden', 'velvet-orbit', 'amber-current', 'driving-inventions']) {
  const recipe = explorationPerformance(createPerformance(seed), seed).recipe;
  // Exercise moving figures and source recurrence while retaining the recipe's
  // independently generated form, density and native-tuning preferences.
  recipe.initialParameters.bassMobility = .85;
  recipe.initialParameters.bassIndependence = .85;
  recipe.conductor!.tuningTravel = true;
  const engine = new MusicEngine({ ...recipe, parameters: recipe.initialParameters });
  const frames: Frame[] = [], costs: number[] = [];
  for (let index = 0; index < 384; index++) {
    const start = performance.now(); frames.push(engine.step()); costs.push(performance.now() - start);
  }
  const restored = parsePerformance(serializePerformance(recipe));
  const replay = new MusicEngine({ ...restored, parameters: restored.initialParameters });
  const exactReplay = frames.every(frame => JSON.stringify(frame) === JSON.stringify(replay.step()));
  const thoughts = [...new Map(frames.filter(frame => frame.phrase).map(frame => [frame.phrase!.startTick, frame.phrase!])).values()];
  const complete = thoughts.filter(phrase => phrase.endTick <= frames.at(-1)!.tick + frames.at(-1)!.duration);
  const signatures = complete.map(phrase => JSON.stringify(phrase.themeCore!.notes.map(note => [
    note.startTick - phrase.startTick, note.endTick - note.startTick, note.absolutePitchCents])));
  const repetitionPairs = complete.flatMap((phrase, index) => complete.slice(0, index).flatMap((older, previous) =>
    older.themeCore!.id === phrase.themeCore!.id ? [{ identical: signatures[index] === signatures[previous] }] : []));
  const notes = frames.flatMap(frame => frame.notes), lead = notes.filter(note => note.voice === 5);
  const pitchedBass = frames.flatMap(frame => frame.notes.filter(note => note.part === 'bass' && note.absolutePitch).map(note => {
    const distance = Math.abs(note.absolutePitch!.millicents - frame.bassPitch.millicents) % 1200000;
    return { note, root: Math.min(distance, 1200000 - distance) < 2 };
  }));
  const sections = [...new Map(frames.map(frame => [frame.form!.sectionIndex, frame.form!])).values()];
  const changes = sections.slice(1).filter((form, index) => form.meter.numerator !== sections[index].meter.numerator || form.meter.denominator !== sections[index].meter.denominator);
  const coincident = new Map<number, Set<string>>();
  for (const note of notes) { const parts = coincident.get(note.tick) ?? new Set<string>(); parts.add(note.part); coincident.set(note.tick, parts); }
  const fillNotes = notes.filter(note => note.id.startsWith('transition:') || note.id.startsWith('ensemble-fill:'));
  const sorted = [...costs].sort((a, b) => a - b);
  cases.push({ seed, frames: frames.length, exactReplay, eventHash: eventHash(notes),
    completeThoughts: complete.length, motifCounts: complete.map(phrase => phrase.composition!.motifs.length),
    graphAvailable: complete.every(phrase => !!phrase.composition?.fingerprint && phrase.composition.motifs.every(motif => !!motif.relationship)),
    repeatedSourcePairs: repetitionPairs.length, exactWholeThoughtCopies: repetitionPairs.filter(pair => pair.identical).length,
    leadAttacks: lead.length, structuralNotes: lead.filter(note => note.expression?.role === 'anchor').length,
    ornaments: lead.filter(note => note.expression?.role === 'ornament').length,
    eighthAlignedStructuralShare: lead.filter(note => note.expression?.role === 'anchor' && note.tick % 240 === 0).length
      / Math.max(1, lead.filter(note => note.expression?.role === 'anchor').length),
    bassAttacks: pitchedBass.length, nonRootBassAttacks: pitchedBass.filter(item => !item.root).length,
    writtenBassPitches: new Set(pitchedBass.map(item => item.note.absolutePitch!.millicents)).size,
    distinctFillOnsets: new Set(fillNotes.map(note => note.tick)).size,
    sharedTwoPartOnsets: [...coincident.values()].filter(parts => parts.size >= 2).length,
    sharedThreePartOnsets: [...coincident.values()].filter(parts => parts.size >= 3).length,
    glides: notes.filter(note => note.endPitch).length,
    interiorLeadGlides: frames.flatMap(frame => frame.notes.filter(note => note.voice === 5 && note.endPitch
      && frame.phrase && note.tick > frame.phrase.startTick + 960 && note.tick < frame.phrase.endTick - 480)).length,
    sections: sections.length, meterChanges: changes.length, meterReasons: changes.map(form => form.meterReason),
    tunings: [...new Set(frames.map(frame => frame.sound.tuning))],
    planningMs: { mean: costs.reduce((sum, value) => sum + value, 0) / costs.length, p95: sorted[Math.floor(sorted.length * .95)], max: sorted.at(-1) },
  });
}
const report = { engineVersion: ENGINE_VERSION, sourceHashes: before,
  sourcesStableDuringCapture: JSON.stringify(before) === JSON.stringify(sourceHashes()),
  method: '384 committed frames per seeded exploration recipe with bass mobility/independence .85 and tuning journeys enabled. Exact JSON replay, source hierarchy, literal full-thought copies, scored anchors, actual emitted bass/fill/coincident attacks and interior foreground glides. Event measurements; no subjective listening claim.', cases };
const output = process.argv[2] ?? '.audit/idea-hierarchy-v17.json';
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ output, sourcesStableDuringCapture: report.sourcesStableDuringCapture, cases }, null, 2));
if (!report.sourcesStableDuringCapture || cases.some(item => !item.exactReplay || !item.graphAvailable)) process.exitCode = 1;
