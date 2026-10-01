import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MusicEngine, eventHash } from '../src/engine';
import { createPerformance, parsePerformance, serializePerformance } from '../src/serialization';
import { explorationPerformance } from '../src/exploration';
import { barToTick, formAt } from '../src/conductor';
import { openingGesture } from '../src/form-score';
import { DEFAULT_SOUND } from '../src/spectrum';
import { degreeToPitch, pitchToDegree, type TuningId } from '../src/pitch';
import { restAppliesToNote, type PhraseRest } from '../src/phrasing';
import { ENGINE_VERSION, FRAME_TICKS, PPQ, type Frame, type NoteEvent, type Performance } from '../src/types';

const round = (value: number) => Math.round(value * 1e6) / 1e6;
const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
const range = (values: number[]) => values.length ? [Math.min(...values), Math.max(...values)].map(round) : [0, 0];
const pitched = (note: NoteEvent) => note.part !== 'percussion' && !!note.absolutePitch;
const voiceKey = (note: NoteEvent) => `${note.part}:${note.voice}`;

/** Controlled endpoints: the common composer remains present, while form and
 * expressive macro movement are held neutral. The two tested controls are
 * explicit lanes so no role profile can silently override the experiment. */
export function controlledRangeRecipe(seed: string, ideaDensity: 0 | 1, ensembleSize: 0 | 1, tuning: TuningId = '12tet'): Performance {
  const recipe = createPerformance(seed);
  recipe.initialParameters = { ...recipe.initialParameters, ideaDensity, ensembleSize, tempo: 108 };
  recipe.conductor = { ...recipe.conductor!, enabled: true, amount: 0, pace: .6, tuningTravel: false };
  recipe.phrasing = { ...recipe.phrasing!, composition: { ...recipe.phrasing!.composition!, dynamicRange: 0 } };
  recipe.automation = [
    { parameter: 'ideaDensity', points: [{ tick: 0, value: ideaDensity, curve: 'step' }] },
    { parameter: 'ensembleSize', points: [{ tick: 0, value: ensembleSize, curve: 'step' }] },
  ];
  if (tuning === '19edo') recipe.sound = { ...structuredClone(DEFAULT_SOUND), tuning, instrument: 'additive' };
  return parsePerformance(serializePerformance(recipe));
}

/** Exact symbolic sounding occupancy. Off events cannot resurrect an older
 * replaced note; published scoped rests stop the affected holds. Effects and
 * short synthesis replacement crossfades are intentionally outside this count. */
function occupancy(notes: NoteEvent[], rests: PhraseRest[], start: number, end: number) {
  type Event = { tick: number; order: number; note?: NoteEvent; rest?: PhraseRest; on?: boolean };
  const events: Event[] = notes.flatMap(note => [{ tick: note.tick, order: 2, note, on: true },
    { tick: Math.min(end, note.tick + note.duration), order: 0, note, on: false }]);
  for (const rest of rests) events.push({ tick: rest.startTick, order: 1, rest });
  events.sort((a, b) => a.tick - b.tick || a.order - b.order || (a.note?.voice ?? -1) - (b.note?.voice ?? -1));
  const active = new Map<string, NoteEvent>();
  let cursor = start, area = 0, soundingTicks = 0, singleVoiceTicks = 0, referenceTicks = 0, maxVoices = 0, pitchesAtMaximum = 0;
  const advance = (to: number) => {
    const width = Math.max(0, to - cursor), count = active.size;
    area += width * count;
    if (count > 0) soundingTicks += width;
    if (count === 1) singleVoiceTicks += width;
    if ([0, 1, 2, 3].every(voice => active.has(`harmony:${voice}`)) && active.has('bass:4')) referenceTicks += width;
    if (count > maxVoices && width > 0) {
      maxVoices = count;
      pitchesAtMaximum = new Set([...active.values()].map(note => note.absolutePitch!.millicents)).size;
    }
    cursor = to;
  };
  for (const event of events) {
    if (event.tick >= end) break;
    if (event.tick >= start) advance(event.tick);
    if (event.rest) {
      for (const [key, note] of active) if (restAppliesToNote(note, event.rest)) active.delete(key);
    } else if (event.on) {
      if (!rests.some(rest => rest.startTick <= event.tick && event.tick < rest.endTick && restAppliesToNote(event.note!, rest))) active.set(voiceKey(event.note!), event.note!);
    } else if (active.get(voiceKey(event.note!))?.id === event.note!.id) active.delete(voiceKey(event.note!));
  }
  advance(end);
  return { maxVoices, pitchesAtMaximum, meanVoices: round(area / Math.max(1, end - start)),
    meanVoicesWhileSounding: round(area / Math.max(1, soundingTicks)),
    singleVoiceFraction: round(singleVoiceTicks / Math.max(1, end - start)),
    silenceFraction: round(1 - soundingTicks / Math.max(1, end - start)),
    referenceBedFraction: round(referenceTicks / Math.max(1, end - start)) };
}

export function summarizeRange(frames: Frame[]) {
  const start = frames[0]?.tick ?? 0, end = frames.at(-1) ? frames.at(-1)!.tick + frames.at(-1)!.duration : start;
  const notes = frames.flatMap(frame => frame.notes).filter(note => note.tick >= start && note.tick < end);
  const lead = notes.filter(note => note.part === 'melody' && note.voice === 5).sort((a, b) => a.tick - b.tick);
  const pitchedNotes = notes.filter(pitched), beatCount = (end - start) / PPQ;
  const rests = [...new Map(frames.flatMap(frame => frame.phrase?.rests ?? []).map(rest => [JSON.stringify(rest), rest])).values()];
  const pitches = lead.map(note => note.absolutePitch!.millicents / 1000);
  const leadRange = range(pitches);
  const notesByPart = Object.fromEntries(['melody', 'harmony', 'bass', 'percussion'].map(part => [part, notes.filter(note => note.part === part).length]));
  const argumentsHeard = [...new Map(frames.filter(frame => frame.phrase).map(frame => [frame.phrase!.startTick, frame.phrase!])).values()]
    .filter(phrase => phrase.startTick >= start && phrase.endTick <= end)
    .map(phrase => ({ quarters: (phrase.endTick - phrase.startTick) / PPQ,
      attacks: lead.filter(note => note.tick >= phrase.startTick && note.tick < phrase.endTick).length,
      kind: phrase.themeCore?.realization?.kind ?? 'unspecified' }));
  const nativeNotesValid = frames.every(frame => frame.notes.filter(pitched).every(note => {
    const expected = degreeToPitch(frame.sound.tuning, pitchToDegree(frame.sound.tuning, note.absolutePitch!));
    return Math.abs(expected.millicents - note.absolutePitch!.millicents) <= 1;
  }));
  return { frames: frames.length, quarters: beatCount, notes: notes.length, notesByPart,
    leadAttacks: lead.length, leadAttacksPerQuarter: round(lead.length / Math.max(1, beatCount)),
    leadDurationQuarters: range(lead.map(note => note.duration / PPQ)),
    leadPitchCents: leadRange, leadRegisterSpanCents: round(leadRange[1] - leadRange[0]),
    leadTravelCentsPerQuarter: round(pitches.slice(1).reduce((sum, pitch, index) => sum + Math.abs(pitch - pitches[index]), 0) / Math.max(1, beatCount)),
    leadCoreAttacks: lead.filter(note => note.expression?.role === 'anchor').length,
    leadSourceIds: new Set(lead.map(note => note.expression?.sourceId).filter(Boolean)).size,
    completeArguments: { count: argumentsHeard.length, quarters: range(argumentsHeard.map(argument => argument.quarters)),
      attacks: range(argumentsHeard.map(argument => argument.attacks)),
      attacksPerQuarter: range(argumentsHeard.map(argument => argument.attacks / argument.quarters)),
      kinds: [...new Set(argumentsHeard.map(argument => argument.kind))] },
    pitchedVoices: [...new Set(pitchedNotes.map(note => note.voice))].sort((a, b) => a - b),
    colors: [...new Set(pitchedNotes.map(note => note.timbre).filter(Boolean))].sort(),
    occupancy: occupancy(pitchedNotes, rests, start, end), nativeNotesValid,
    plannedVoicingsMatchDestinations: frames.every(frame => frame.diagnostics.harmonicPlan?.realization.matched),
    allThemeCores: frames.every(frame => !!frame.phrase?.themeCore),
    tempo: range(frames.map(frame => frame.parameters.tempo)),
    arrangementNames: [...new Set(frames.map(frame => frame.diagnostics.arrangement?.name).filter(Boolean))],
    arrangementDiagnosticsPresent: frames.every(frame => !!frame.diagnostics.arrangement),
    eventHash: eventHash(notes) };
}

export function renderRange(recipe: Performance, count = 96, replay = true) {
  const engine = new MusicEngine({ ...recipe, parameters: recipe.initialParameters }), frames: Frame[] = [], costs: number[] = [];
  for (let index = 0; index < count; index++) {
    const start = performance.now(); frames.push(engine.step());
    if (index >= 8) costs.push(performance.now() - start);
  }
  let exactReplay: boolean | null = null;
  if (replay) {
    const loaded = parsePerformance(serializePerformance(recipe));
    const restored = new MusicEngine({ ...loaded, parameters: loaded.initialParameters });
    exactReplay = frames.every(frame => JSON.stringify(frame) === JSON.stringify(restored.step()));
  }
  costs.sort((a, b) => a - b);
  return { frames, summary: summarizeRange(frames), exactReplay,
    planningMs: { warmupFramesExcluded: 8, mean: round(mean(costs)), p95: round(costs[Math.floor(costs.length * .95)] ?? 0), maximum: round(costs.at(-1) ?? 0) } };
}

function narrativeFrames(recipe: Performance): number {
  let tick = 0;
  for (let section = 0; section < 32; section++) {
    const form = formAt(recipe.seed, tick, recipe.conductor!, recipe.sound.tuning);
    if (form.cycle > 0) {
      const count = Math.ceil(tick / FRAME_TICKS);
      if (count > 640) throw new Error('The complete narrative exceeds the audit frame budget.');
      return count;
    }
    tick = form.sectionEndTick;
  }
  throw new Error('The bounded range audit did not find the end of the first narrative.');
}

type ControlledCase = ReturnType<typeof summarizeRange> & {
  seed: string; tuning: TuningId; ideaDensity: 0 | 1; ensembleSize: 0 | 1;
  exactReplay: boolean | null; planningMs: ReturnType<typeof renderRange>['planningMs'];
};

export function auditRange() {
  const controls: ControlledCase[] = [];
  for (const seed of ['glass-garden', 'velvet-orbit', 'amber-current']) for (const ideaDensity of [0, 1] as const) for (const ensembleSize of [0, 1] as const) {
    const recipe = controlledRangeRecipe(seed, ideaDensity, ensembleSize);
    const result = renderRange(recipe, narrativeFrames(recipe));
    controls.push({ seed, tuning: '12tet', ideaDensity, ensembleSize, ...result.summary, exactReplay: result.exactReplay, planningMs: result.planningMs });
  }
  const native: ControlledCase[] = [];
  for (const ideaDensity of [0, 1] as const) for (const ensembleSize of [0, 1] as const) {
    const recipe = controlledRangeRecipe('native-range', ideaDensity, ensembleSize, '19edo');
    const result = renderRange(recipe, narrativeFrames(recipe));
    native.push({ seed: 'native-range', tuning: '19edo', ideaDensity, ensembleSize, ...result.summary, exactReplay: result.exactReplay, planningMs: result.planningMs });
  }
  const openings = Array.from({ length: 24 }, (_, index) => {
    const seed = `range-opening-${index}`, { recipe, description } = explorationPerformance(createPerformance(seed), seed);
    const end = barToTick(seed, 8, recipe.conductor!), result = renderRange(recipe, Math.ceil(end / FRAME_TICKS), false);
    const first = result.frames[0], intention = first.diagnostics.compositionExpression!;
    return { seed, description, opening: openingGesture(seed), behavior: formAt(seed, 0, recipe.conductor!).behavior,
      initial: { intensity: intention.intensity, pace: intention.pace, ideaDensity: first.parameters.ideaDensity, ensembleSize: first.parameters.ensembleSize },
      ...result.summary, planningMs: result.planningMs };
  });
  const checks = {
    exactReplay: [...controls, ...native].every(result => result.exactReplay),
    nativeGrid: [...controls, ...native, ...openings].every(result => result.nativeNotesValid),
    sourceAndHarmony: [...controls, ...native, ...openings].every(result => result.allThemeCores && result.plannedVoicingsMatchDestinations),
    fixedTempo: [...controls, ...native, ...openings].every(result => result.tempo[0] === result.tempo[1]),
    exposedSingleVoice: controls.filter(result => result.ensembleSize === 0).every(result => result.pitchedVoices.length === 1 && result.occupancy.maxVoices === 1),
    largeEnsemble: controls.filter(result => result.ensembleSize === 1).every(result => result.occupancy.maxVoices >= 10 && result.colors.length >= 4),
    // Concise thoughts retain the identifying head and one destination;
    // compare the route average without requiring long sparse residence.
    sparseLead: controls.filter(result => result.ideaDensity === 0).every(result => result.leadAttacksPerQuarter < .75),
    denseLead: controls.filter(result => result.ideaDensity === 1).every(result => result.leadAttacksPerQuarter > 1.5),
    leadDensityContrast: controls.filter(result => result.ideaDensity === 1).every(dense => {
      const sparse = controls.find(result => result.seed === dense.seed && result.ensembleSize === dense.ensembleSize && result.ideaDensity === 0)!;
      return dense.leadAttacksPerQuarter > sparse.leadAttacksPerQuarter * 3;
    }),
    audibleOpeningDiversity: openings.some(result => result.leadAttacksPerQuarter > 1.2 && result.occupancy.maxVoices >= 8)
      && openings.some(result => result.leadAttacksPerQuarter < .5 && result.occupancy.maxVoices <= 4),
  };
  const report = { engineVersion: ENGINE_VERSION,
    methodology: 'Controlled windows are the complete first narrative, bounded to 640 frames, so a cutoff cannot omit its closing release. Openings use the first eight true bars. Emitted score events: pitched occupancy honors replacement and scoped rests, excluding FX and short replacement tails. Controls use fixed form freedom/breadth with explicit endpoint lanes. Sparse thoughts select a complete head and destination from the available source vocabulary; density refines moving intervals without forcing repeated contour loops. Additive preserves its five-tone reference bed. Planning excludes first eight frames. Numeric evidence is not subjective audition.',
    checks, passed: Object.values(checks).every(Boolean), controls, native, openings };
  writeFileSync('range-audit.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ engineVersion: ENGINE_VERSION, checks,
    leadRate: { sparse: range(controls.filter(result => !result.ideaDensity).map(result => result.leadAttacksPerQuarter)), dense: range(controls.filter(result => result.ideaDensity).map(result => result.leadAttacksPerQuarter)) },
    pitchedVoices: range(controls.map(result => result.occupancy.maxVoices)),
    openingKinds: [...new Set(openings.map(result => result.opening))],
    planningMs: { mean: round(mean(controls.map(result => result.planningMs.mean))), p95: range(controls.map(result => result.planningMs.p95)) } }, null, 2));
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!auditRange().passed) process.exitCode = 1;
}
