import { writeFileSync } from 'node:fs';
import { MusicEngine, eventHash } from '../src/engine';
import { createPerformance, parsePerformance, serializePerformance } from '../src/serialization';
import { lyricalPerformance } from '../src/lyrical';
import { explorationPerformance } from '../src/exploration';
import { expressionScoreSummary, selectExpressionExcerpts } from '../src/expression-audit';
import { ENGINE_VERSION, type Frame } from '../src/types';

const cases = [];
const range = (values: number[]) => [Math.min(...values), Math.max(...values)].map(value => Math.round(value * 10000) / 10000);
for (const seed of ['glass-garden', 'velvet-orbit', 'amber-current']) for (const character of ['singing', 'exploration'] as const) {
  const recipe = (character === 'singing' ? lyricalPerformance : explorationPerformance)(createPerformance(seed), seed).recipe;
  const engine = new MusicEngine({ ...recipe, parameters: recipe.initialParameters });
  const frames: Frame[] = [], costs: number[] = [];
  while (frames.length < 640) {
    const start = performance.now(), frame = engine.step(); costs.push(performance.now() - start);
    if (frame.form!.cycle > 0) break;
    frames.push(frame);
  }
  const replayRecipe = parsePerformance(serializePerformance(recipe));
  const replay = new MusicEngine({ ...replayRecipe, parameters: replayRecipe.initialParameters });
  const exactReplay = frames.every(frame => JSON.stringify(frame) === JSON.stringify(replay.step()));
  const excerpts = selectExpressionExcerpts(frames, seed, 8, recipe.conductor);
  const passages = excerpts.map(excerpt => ({ kind: excerpt.kind, energy: excerpt.meanEnergy,
    ...expressionScoreSummary(frames.slice(excerpt.start, excerpt.end), frames[excerpt.start].tick) }));
  const notes = frames.flatMap(frame => frame.notes), sorted = [...costs].sort((a, b) => a - b);
  const dimensions = Object.fromEntries(['energy', 'activity', 'intensity', 'register', 'sustain', 'accent', 'pace', 'rhythmDrive'].map(key => [key,
    range(frames.map(frame => frame.diagnostics.compositionExpression![key as 'energy']))]));
  const result = { seed, character, frames: frames.length, exactReplay, eventHash: eventHash(notes),
    allCores: frames.every(frame => !!frame.phrase?.themeCore), allDestinations: frames.every(frame => frame.diagnostics.harmonicPlan?.realization.matched),
    dimensions, tempo: range(frames.map(frame => frame.parameters.tempo)),
    colors: [...new Set(notes.map(note => note.timbre).filter(Boolean))], articulations: [...new Set(notes.map(note => note.articulation).filter(Boolean))],
    themes: [...new Set(frames.map(frame => frame.phrase!.themeCore!.id))],
    protectedCoreNotes: notes.filter(note => note.part === 'melody' && note.expression?.role === 'anchor').length,
    ornaments: notes.filter(note => note.expression?.role === 'ornament').length,
    meanPlanningMs: costs.reduce((sum, value) => sum + value, 0) / costs.length,
    p95PlanningMs: sorted[Math.floor(sorted.length * .95)], maxPlanningMs: sorted.at(-1), passages };
  cases.push(result);
  console.log(JSON.stringify({ seed, character, frames: result.frames, exactReplay, destinations: result.allDestinations,
    energy: dimensions.energy, intensity: dimensions.intensity, ornaments: result.ornaments,
    calmAttacks: passages.find(passage => passage.kind === 'calm')!.observedAttacksPerBeat, crestAttacks: passages.find(passage => passage.kind === 'crest')!.observedAttacksPerBeat,
    meanMs: result.meanPlanningMs, p95Ms: result.p95PlanningMs }));
}
const checks = {
  exactReplay: cases.every(item => item.exactReplay),
  protectedSourcesAndDestinations: cases.every(item => item.allCores && item.allDestinations),
  steadyTempo: cases.every(item => item.tempo[0] === item.tempo[1]),
  boundedSpectra: cases.every(item => Object.values(item.dimensions).every(([low, high]) => low >= 0 && high <= 1 && Number.isFinite(low + high))),
  // Each narrative must move, but a quiet first journey need not contain a
  // compulsory climax. Verify broad contrast across the cohort separately.
  expressiveNarratives: cases.every(item => item.dimensions.intensity[1] - item.dimensions.intensity[0] > .2
    && item.dimensions.pace[1] - item.dimensions.pace[0] > .25),
  broadContrastAvailable: cases.some(item => item.dimensions.intensity[1] - item.dimensions.intensity[0] > .7),
};
const passed = Object.values(checks).every(Boolean);
writeFileSync('integrated-composition-audit.json', JSON.stringify({ engineVersion: ENGINE_VERSION, passed, checks, cases }, null, 2));
if (!passed) process.exitCode = 1;
