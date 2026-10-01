import assert from 'node:assert/strict';
import { MusicEngine, eventHash } from '../src/engine';
import { DEFAULT_CONDUCTOR, formAt } from '../src/conductor';
import { DEFAULT_PARAMETERS } from '../src/parameters';
import { DEFAULT_PHRASING, restAppliesToNote, type PhraseRest } from '../src/phrasing';
import { DEFAULT_COMPOSITION, type IndependentLayerSnapshot, type StructuralCue, type TransitionSnapshot } from '../src/composition';
import { CounterpointLayer } from '../src/engine/counterpoint';
import { grooveLayersAt } from '../src/engine/groove';
import { ScoreTimeline } from '../src/engine/score-timeline';
import { ENGINE_VERSION, FRAME_TICKS, PPQ, type Frame, type NoteEvent } from '../src/types';

const rounded = (value: number) => Math.round(value * 1000) / 1000;
const intersects = (start: number, end: number, otherStart: number, otherEnd: number) => start < otherEnd && end > otherStart;
const histogram = (values: readonly (string | number)[]) => Object.fromEntries([...new Set(values)].sort((a, b) => Number(a) - Number(b))
  .map(value => [String(value), values.filter(other => other === value).length]));

function mergedLength(intervals: Array<{ start: number; end: number }>): number {
  const sorted = intervals.filter(item => item.end > item.start).sort((a, b) => a.start - b.start || a.end - b.end);
  let total = 0, start = -1, end = -1;
  for (const next of sorted) {
    if (next.start > end) { total += end - start; start = next.start; end = next.end; }
    else end = Math.max(end, next.end);
  }
  return total + end - start;
}

function clock(frames: Frame[]) {
  let seconds = 0;
  const starts = frames.map(frame => { const start = seconds; seconds += frame.duration / PPQ * 60 / frame.parameters.tempo; return start; });
  return {
    duration: seconds,
    at: (tick: number) => {
      if (tick <= 0) return 0;
      const index = Math.floor(tick / FRAME_TICKS);
      if (index >= frames.length) return seconds;
      const frame = frames[index];
      return starts[index] + (tick - frame.tick) / PPQ * 60 / frame.parameters.tempo;
    },
  };
}

function layerLifetimes(seed: string, frames: Frame[], notes: NoteEvent[], endTick: number) {
  const cycles = new Map<string, IndependentLayerSnapshot>();
  for (const frame of frames) for (const layer of frame.phrase?.composition?.layers ?? []) cycles.set(`${layer.id}:${layer.cycleStartTick}`, layer);
  // A source can change inside the last 960-tick commit. Read the same pure
  // clocks at their 240-tick boundary grid so a partial final lifetime is not
  // omitted merely because no subsequent frame sampled its metadata. The
  // tonic is irrelevant to CounterpointLayer.snapshot (no notes are generated).
  const score = new ScoreTimeline({ seed, parameters: DEFAULT_PARAMETERS, conductor: DEFAULT_CONDUCTOR, phrasing: DEFAULT_PHRASING });
  const counterClock = new CounterpointLayer(seed, DEFAULT_COMPOSITION, 0, tick => formAt(seed, tick, DEFAULT_CONDUCTOR));
  for (let tick = 0; tick < endTick; tick += 240) {
    for (const layer of [counterClock.snapshot(tick), ...grooveLayersAt(tick, score.textureAt(tick).rhythm!)]) {
      cycles.set(`${layer.id}:${layer.cycleStartTick}`, layer);
    }
  }
  return [...new Set([...cycles.values()].map(layer => layer.id))].map(id => {
    const rows = [...cycles.values()].filter(layer => layer.id === id);
    const sources = [...new Set(rows.map(layer => layer.sourceId))].map(sourceId => {
      const owned = rows.filter(layer => layer.sourceId === sourceId);
      const start = Math.max(0, Math.min(...owned.map(layer => layer.cycleStartTick)));
      const end = Math.min(endTick, Math.max(...owned.map(layer => layer.cycleEndTick)));
      const sourceNotes = notes.filter(note => note.tick >= start && note.tick < end && (owned[0].role === 'counter' ? note.voice === 8
        : (note.part === 'bass' || note.part === 'percussion') && note.expression?.sourceId === sourceId));
      const sections = new Set(frames.filter(frame => intersects(frame.tick, frame.tick + frame.duration, start, end)).map(frame => frame.form!.sectionIndex));
      return { sourceId, observedStartTick: start, observedEndTick: end, durationQuarterNotes: rounded((end - start) / PPQ),
        cyclesObserved: owned.length, activeCycles: owned.filter(layer => layer.active).length,
        storedAttacks: sourceNotes.length, sectionsSpanned: sections.size };
    });
    return { id, role: rows[0].role, cycleTicks: rows[0].cycleTicks, distinctSources: sources.length,
      sourceChanges: Math.max(0, sources.length - 1), sourcesSpanningSectionBoundaries: sources.filter(source => source.sectionsSpanned > 1).length, sources };
  });
}

for (const seed of ['glass-garden', 'velvet-orbit', 'amber-current']) {
  const engine = new MusicEngine({ seed, parameters: DEFAULT_PARAMETERS, conductor: DEFAULT_CONDUCTOR, phrasing: DEFAULT_PHRASING });
  const frames: Frame[] = [];
  let elapsedMs = 0, finishedRoute = false;
  for (let index = 0; index < 1200; index++) {
    const before = performance.now(), frame = engine.step(), cost = performance.now() - before;
    if (frame.form!.cycle !== 0) { finishedRoute = true; break; }
    frames.push(frame); elapsedMs += cost;
  }
  assert.ok(finishedRoute && frames.length, `${seed}: audit must include a complete first route`);
  const routeEnd = frames.at(-1)!.tick + frames.at(-1)!.duration;
  const notes = frames.flatMap(frame => frame.notes);
  const timeline = clock(frames);
  const thoughts = [...new Map(frames.map(frame => [frame.phrase!.composition!.phraseId, frame])).values()];
  const sections = [...new Map(frames.map(frame => [frame.form!.sectionIndex, frame.form!])).values()];
  const cells = thoughts.flatMap(frame => (frame.phrase!.composition!.shortPhrases ?? []).map(cell => {
    const form = frame.form!;
    // Global tick % barTicks is wrong after a differently metered section.
    const startBar = (cell.startTick - form.sectionStartTick) / form.barTicks;
    const endBar = (cell.endTick - 1 - form.sectionStartTick) / form.barTicks;
    const actualCore = notes.filter(note => (note.voice === 5 || note.voice === 7) && note.expression?.role === 'anchor'
      && note.tick >= cell.startTick && note.tick < cell.endTick && note.expression.sourceId?.startsWith(`${cell.sourceId}:`));
    return { ...cell, sectionIndex: form.sectionIndex, barTicks: form.barTicks, startBar, endBar, actualCore: actualCore.length,
      crossesBar: Math.floor(startBar) !== Math.floor(endBar) };
  }));
  const cueMap = new Map<string, StructuralCue>();
  const restMap = new Map<string, PhraseRest>();
  for (const frame of frames) {
    for (const cue of frame.phrase!.composition!.cues) cueMap.set(cue.id, cue);
    for (const rest of frame.phrase!.rests) restMap.set(`${rest.scope}:${rest.startTick}:${rest.endTick}:${rest.voices?.join(',') ?? '*'}`, rest);
  }
  const rests = [...restMap.values()];
  const restViolations = rests.flatMap(rest => notes.filter(note => restAppliesToNote(note, rest)
    && intersects(note.tick, note.tick + note.duration, rest.startTick, rest.endTick)));
  assert.equal(restViolations.length, 0, `${seed}: scoped source rests must be respected`);
  const cellCues = [...cueMap.values()].filter(cue => cue.ensemble === 'cell' && cue.tick < routeEnd);
  const support = cellCues.map(cue => {
    const simultaneous = notes.filter(note => note.tick === cue.tick);
    const lead = simultaneous.some(note => note.part === 'melody' && note.voice === cue.leadVoice);
    const explicitParts = new Set(simultaneous.filter(note => note.expression?.role === 'support' && note.expression.cueId === cue.id).map(note => note.part));
    return { sourceId: cue.sourceId, lead, simultaneousParts: new Set(simultaneous.map(note => note.part)).size,
      explicitParts: explicitParts.size, threeParts: lead && explicitParts.size >= 2 };
  });
  const counter = notes.filter(note => note.voice === 8);
  const foregroundRests = rests.filter(rest => rest.scope === 'lead'
    && [5, 6, 7].some(voice => restAppliesToNote({ part: 'melody', voice }, rest))
    && !restAppliesToNote({ part: 'melody', voice: 8 }, rest));
  const overlaps = counter.flatMap(note => foregroundRests.flatMap(rest => {
    const start = Math.max(note.tick, rest.startTick), end = Math.min(note.tick + note.duration, rest.endTick, routeEnd);
    return end > start ? [{ noteId: note.id, start, end, restStart: rest.startTick, restEnd: rest.endTick, reason: rest.reason }] : [];
  })).sort((a, b) => a.start - b.start || a.end - b.end);
  const firstOverlap = overlaps[0];
  const transitionMap = new Map<number, TransitionSnapshot>();
  for (const frame of frames) {
    const transition = frame.phrase!.composition!.transition;
    if (transition && transition.startTick < routeEnd) transitionMap.set(transition.boundaryTick, transition);
  }
  const transitions = [...transitionMap.values()].sort((a, b) => a.boundaryTick - b.boundaryTick).map(transition => {
    const actual = notes.filter(note => note.id.startsWith('transition:') && note.tick >= transition.startTick && note.tick < transition.endTick);
    return { boundaryTick: transition.boundaryTick, boundarySeconds: rounded(timeline.at(transition.boundaryTick)),
      kind: transition.kind, reason: transition.reason, preparationNotes: actual.filter(note => note.tick < transition.boundaryTick).length,
      arrivalNotes: actual.filter(note => note.tick >= transition.boundaryTick).length, arrivalWithinRoute: transition.boundaryTick < routeEnd };
  });
  const windowStart = firstOverlap ? Math.max(0, Math.floor((firstOverlap.start - 4 * PPQ) / FRAME_TICKS) * FRAME_TICKS) : 0;
  const windowEnd = firstOverlap ? Math.min(routeEnd, Math.ceil((firstOverlap.end + 8 * PPQ) / FRAME_TICKS) * FRAME_TICKS) : Math.min(routeEnd, 32 * FRAME_TICKS);
  const nextArrival = firstOverlap ? transitions.find(transition => transition.boundaryTick > firstOverlap.end && transition.arrivalWithinRoute) : undefined;
  const arrivalPrefixEnd = nextArrival ? Math.min(routeEnd, nextArrival.boundaryTick + FRAME_TICKS) : windowEnd;
  assert.ok(notes.every(note => Number.isSafeInteger(note.tick) && Number.isSafeInteger(note.duration) && note.duration > 0));
  console.log(JSON.stringify({ seed, engineVersion: ENGINE_VERSION, route: frames[0].form!.formName,
    frames: frames.length, routeTicks: routeEnd, routeSeconds: rounded(timeline.duration), millisecondsPerFrame: rounded(elapsedMs / frames.length),
    cells: { total: cells.length, actualCycleEighths: histogram(cells.map(cell => cell.cycleTicks / 240)), coreNotesPerCell: histogram(cells.map(cell => cell.coreNotes)),
      fullySounded: cells.filter(cell => cell.actualCore === cell.coreNotes).length, crossingSectionRelativeBars: cells.filter(cell => cell.crossesBar).length,
      phaseIndependentEntries: cells.filter(cell => (cell.startTick - sections.find(section => section.sectionIndex === cell.sectionIndex)!.sectionStartTick) % cell.barTicks !== 0).length,
      transformedRepeats: cells.filter(cell => cell.transpositionCents !== 0 || cell.intervalScale !== 1).length,
      crossingExamples: cells.filter(cell => cell.crossesBar).slice(0, 4).map(cell => ({ sourceId: cell.sourceId, sectionIndex: cell.sectionIndex,
        startTick: cell.startTick, endTick: cell.endTick, cycleTicks: cell.cycleTicks, sectionRelativeStartBar: rounded(cell.startBar), sectionRelativeEndBar: rounded(cell.endBar) })) },
    sharedCellSupport: { cues: cellCues.length, simultaneousAtLeastThreeParts: support.filter(item => item.lead && item.simultaneousParts >= 3).length,
      explicitSupportPlusLeadAtLeastThreeParts: support.filter(item => item.threeParts).length,
      sourcesWithRepeatedThreePartSupport: new Set(support.filter(item => item.threeParts && support.filter(other => other.sourceId === item.sourceId && other.threeParts).length > 1).map(item => item.sourceId)).size },
    independentCounter: { notes: counter.length, foregroundBreaths: foregroundRests.length,
      notesOverlappingForegroundBreaths: new Set(overlaps.map(overlap => overlap.noteId)).size,
      breathsWithCounter: new Set(overlaps.map(overlap => `${overlap.restStart}:${overlap.restEnd}`)).size,
      overlapTicks: mergedLength(overlaps),
      firstOverlap: firstOverlap ? { tick: firstOverlap.start, seconds: rounded(timeline.at(firstOverlap.start)), reason: firstOverlap.reason,
        noteId: firstOverlap.noteId, overlapTicks: firstOverlap.end - firstOverlap.start } : null },
    sourceLifetimes: layerLifetimes(seed, frames, notes, routeEnd), transitions,
    audition: { explanation: 'A stored-event overlap witness, not a listening-quality judgment. Render or seek this window to hear the counterline during a foreground breath.',
      startTick: windowStart, endTick: windowEnd, startSeconds: rounded(timeline.at(windowStart)), durationSeconds: rounded(timeline.at(windowEnd) - timeline.at(windowStart)),
      prefixFramesNeeded: Math.ceil(windowEnd / FRAME_TICKS), prefixSecondsNeeded: rounded(timeline.at(windowEnd)),
      prefixIncludingFollowingArrival: { frames: Math.ceil(arrivalPrefixEnd / FRAME_TICKS), seconds: rounded(timeline.at(arrivalPrefixEnd)) } },
    scopedRestViolations: restViolations.length, eventHash: eventHash(notes) }));
}
