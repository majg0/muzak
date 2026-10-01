import { MusicEngine } from './engine';
import { composeThemeCore, themeThird } from './engine/theme-core';
import { gestureTools, transformGesture, type Gesture } from './engine/idea-tools';
import type { ToolCoverage } from './engine/idea-selection';
import { lyricalField } from './engine/lyrical-support';
import { TUNINGS, degreeToPitch, pitchToDegree, type TuningId } from './pitch';
import { MANUAL_CONDUCTOR } from './conductor';
import { createPerformance } from './serialization';
import { ENGINE_VERSION, PPQ, type Frame, type NoteEvent, type Performance } from './types';
import type { IndependentLayerSnapshot } from './composition';

export interface ToolCounts {
  decisions: number; used: Record<string, number>; eligible: Record<string, number>;
  deferred: Record<string, number>; focused: Record<string, number>; fulfilled: number;
}
const counts = (): ToolCounts => ({ decisions: 0, used: {}, eligible: {}, deferred: {}, focused: {}, fulfilled: 0 });
const add = (into: Record<string, number>, names: readonly string[]) => {
  for (const name of new Set(names)) into[name] = (into[name] ?? 0) + 1;
};
function credit(into: ToolCounts, used: readonly string[], coverage?: ToolCoverage): void {
  into.decisions++; add(into.used, used);
  if (!coverage) return;
  add(into.eligible, coverage.eligible); add(into.deferred, coverage.deferred); add(into.focused, [coverage.focus]);
  if (coverage.fulfilled) into.fulfilled++;
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const mod = (n: number, period: number) => ((n % period) + period) % period;

export interface ToolCoverageAudit {
  engineVersion: string; seed: string; tuning: TuningId; frames: number; completeThoughts: number;
  gestures: { current: ToolCounts; inherited: ToolCounts; sourceSelection: ToolCounts;
    unheardGroups: number; excludedNoops: Record<string, number>; maximumToolsPerGesture: number };
  counterpoint: ToolCounts & { unheardEntries: number };
  harmony: ToolCounts & { incompleteOrUnheardRoutes: number };
  /** Observed figures in complete thoughts, grouped without attack ordinal;
   * these are heard events, not an assertion about an unplayed source tail. */
  ornaments: { observedAudibleFigures: number; attacks: number; figuresByKind: Record<string, number>;
    attacksByKind: Record<string, number>; incompleteObservedFigures: number; connectedSlides: number; invalidSlideEvents: number };
  rhythm: { referenceAttacks: number; referenceOffQuarter: number; sourceAttacks: number;
    offQuarterSourceAttacks: number; transitionAttacks: number; layers: Record<string, number> };
  form: { heardSections: number; roles: Record<string, number>; entries: Record<string, number>; cadences: Record<string, number> };
  invalidEvents: number; offNativeGrid: number; tuningTransitionGlides: number; violations: string[];
}

/** Read committed events and their selected source lineage. A proposal, an
 * unused palette clause, or an interrupted gesture earns no heard coverage.
 * Inherited source operations and current transformations remain separate. */
export function toolCoverageFromFrames(seed: string, frames: readonly Frame[]): ToolCoverageAudit {
  if (!frames.length) throw new RangeError('Tool coverage needs committed frames.');
  const tuning = frames[0].sound.tuning, end = frames.at(-1)!.tick + frames.at(-1)!.duration;
  const notes = frames.flatMap(frame => frame.notes);
  const report: ToolCoverageAudit = { engineVersion: ENGINE_VERSION, seed, tuning, frames: frames.length, completeThoughts: 0,
    gestures: { current: counts(), inherited: counts(), sourceSelection: counts(), unheardGroups: 0,
      excludedNoops: {}, maximumToolsPerGesture: 0 }, counterpoint: { ...counts(), unheardEntries: 0 },
    harmony: { ...counts(), incompleteOrUnheardRoutes: 0 },
    ornaments: { observedAudibleFigures: 0, attacks: 0, figuresByKind: {}, attacksByKind: {},
      incompleteObservedFigures: 0, connectedSlides: 0, invalidSlideEvents: 0 },
    rhythm: { referenceAttacks: 0, referenceOffQuarter: 0, sourceAttacks: 0, offQuarterSourceAttacks: 0,
      transitionAttacks: 0, layers: {} }, form: { heardSections: 0, roles: {}, entries: {}, cadences: {} },
    invalidEvents: 0, offNativeGrid: 0, tuningTransitionGlides: 0, violations: [] };
  const violation = (message: string) => { if (report.violations.length < 30) report.violations.push(message); };
  const sources = new Map<string, ReturnType<typeof composeThemeCore>>();
  const sourceFor = (themeId: string) => {
    let core = sources.get(themeId);
    if (!core) { core = composeThemeCore(seed, themeId, themeThird(seed, themeId)); sources.set(themeId, core); }
    return core;
  };
  const thoughts = [...new Map(frames.filter(frame => frame.phrase).map(frame => [frame.phrase!.startTick, frame.phrase!])).values()];
  const ornamentGroups = new Map<string, { kind: string; thought?: typeof thoughts[number]; events: Array<{ note: NoteEvent; ordinal: number }> }>();
  for (const note of notes) {
    if (!note.id.startsWith('phrase:') || note.expression?.role !== 'ornament') continue;
    const match = /^(.*:ornament:([^:]+):\d+):(\d+)$/.exec(note.expression.sourceId ?? '');
    if (!match) continue;
    const thought = thoughts.find(item => note.tick >= item.startTick && note.tick < item.endTick);
    const id = `${thought?.startTick ?? 'uncaptured'}:${match[1]}`;
    const group = ornamentGroups.get(id) ?? { kind: match[2], thought, events: [] };
    group.events.push({ note, ordinal: Number(match[3]) }); ornamentGroups.set(id, group);
    report.ornaments.attacks++; add(report.ornaments.attacksByKind, [group.kind]);
  }
  for (const [id, group] of ornamentGroups) {
    const { thought, kind } = group, ordered = group.events.sort((a, b) => a.ordinal - b.ordinal);
    let valid = ordered.every(({ note, ordinal }, index) => ordinal === index && note.absolutePitch && Number.isFinite(note.absolutePitch.millicents)
      && Number.isSafeInteger(note.tick) && Number.isSafeInteger(note.duration) && note.duration > 0
      && (!index || note.tick > ordered[index - 1].note.tick));
    if (kind === 'connected-slide') for (const { note } of ordered) {
      if (!note.absolutePitch || !note.endPitch || !Number.isFinite(note.absolutePitch.millicents) || !Number.isFinite(note.endPitch.millicents)
        || note.endPitch.millicents === note.absolutePitch.millicents
        || !Number.isSafeInteger(note.glideTicks) || note.glideTicks! <= 0 || note.glideTicks! > note.duration) {
        report.ornaments.invalidSlideEvents++; valid = false; violation(`Ornament slide has no complete audible pitch ramp: ${id}`);
      }
    }
    const last = ordered.at(-1)!.note;
    const following = thought?.themeCore?.notes.find(anchor => anchor.startTick > last.tick);
    const observed = thought && thought.endTick <= end && following
      && ordered.every(({ note }) => note.tick + note.duration <= following.startTick)
      && notes.some(note => note.id.startsWith('phrase:') && note.expression?.role === 'anchor'
        && note.tick === following.startTick && note.absolutePitch?.millicents === Math.round(following.absolutePitchCents * 1000));
    if (!valid || !observed) { report.ornaments.incompleteObservedFigures++; continue; }
    report.ornaments.observedAudibleFigures++; add(report.ornaments.figuresByKind, [kind]);
    if (kind === 'connected-slide') report.ornaments.connectedSlides++;
  }
  for (const thought of thoughts) {
    if (thought.endTick > end || !thought.themeCore) continue;
    report.completeThoughts++;
    const core = sourceFor(thought.themeId), realization = thought.themeCore.realization;
    const head = core.clauses.find(clause => clause.sourceId === core.headId)!;
    const heard = notes.filter(note => note.id.startsWith('phrase:') && note.expression?.role === 'anchor'
      && note.tick >= thought.startTick && note.tick < thought.endTick);
    let complete = true;
    for (const group of realization?.phrases ?? []) {
      const written = thought.themeCore.notes.filter(note => note.startTick >= group.startTick && note.startTick < group.endTick);
      if (!written.length || !written.every(note => heard.some(event => event.tick === note.startTick
        && event.absolutePitch?.millicents === Math.round(note.absolutePitchCents * 1000)))) {
        report.gestures.unheardGroups++; complete = false; continue;
      }
      const clause = core.clauses.find(item => item.sourceId === group.sourceId);
      if (!clause) { violation(`Unknown gesture source: ${group.sourceId}`); continue; }
      const source: Gesture = { sourceId: clause.sourceId, operations: [], notes: clause.notes.map((note, index) => ({
        degree: note.degree, units: note.rhythmUnits, strength: clause.sourceId === core.headId ? core.cell?.attacks[index]?.strength ?? .8 : .8 })) };
      const result = transformGesture(source, group.operations ?? []), current = gestureTools(source, result);
      const anchors = group.anchors ?? written.map(note => ({ degree: note.degree, tick: note.startTick }));
      if (!same(result.notes.map(note => note.degree), anchors.map(note => note.degree))) violation(`Operation replay differs: ${group.id}`);
      if (group.tools && !same([...group.tools].sort(), current)) violation(`Tool labels differ from operation result: ${group.id}`);
      if (group.coverage && group.coverage.used.some(tool => !current.includes(tool))) violation(`Unheard current tool: ${group.id}`);
      credit(report.gestures.current, current, group.coverage);
      report.gestures.maximumToolsPerGesture = Math.max(report.gestures.maximumToolsPerGesture, current.length);
      add(report.gestures.excludedNoops, (group.operations ?? []).map(operation => operation.kind).filter(tool => !current.includes(tool)));
      if (clause.operations?.length) {
        const parent: Gesture = { sourceId: core.headId, operations: [], notes: head.notes.map((note, index) => ({
          degree: note.degree, units: note.rhythmUnits, strength: core.cell?.attacks[index]?.strength ?? .8 })) };
        const inherited = transformGesture(parent, clause.operations);
        if (!same(inherited.notes.map(note => [note.degree, note.units]), clause.notes.map(note => [note.degree, note.rhythmUnits])))
          violation(`Inherited source replay differs: ${clause.sourceId}`);
        credit(report.gestures.inherited, gestureTools(parent, inherited));
      }
    }
    if (complete && realization?.sourceCoverage) credit(report.gestures.sourceSelection, realization.sourceCoverage.used, realization.sourceCoverage);
    if (heard.length) add(report.form.cadences, [thought.composition?.cadence ?? 'unknown']);
  }
  const entries = new Map<string, { layer: IndependentLayerSnapshot; tuning: TuningId }>();
  const sections = new Set<number>(), rhythmicLayers = new Set<string>();
  for (const [frameIndex, frame] of frames.entries()) {
    const pitched = frame.notes.filter(note => note.part !== 'percussion');
    for (const note of frame.notes) {
      if (!Number.isSafeInteger(note.tick) || !Number.isSafeInteger(note.duration) || note.duration <= 0
        || note.tick < frame.tick || note.tick >= frame.tick + frame.duration) report.invalidEvents++;
      if (note.part !== 'percussion' && note.absolutePitch
        && !same(note.absolutePitch, degreeToPitch(frame.sound.tuning, pitchToDegree(frame.sound.tuning, note.absolutePitch)))) {
        const prior = frames[frameIndex - 1]?.sound.tuning;
        const crossing = prior && prior !== frame.sound.tuning && note.endPitch && note.glideTicks
          && same(note.absolutePitch, degreeToPitch(prior, pitchToDegree(prior, note.absolutePitch)))
          && same(note.endPitch, degreeToPitch(frame.sound.tuning, pitchToDegree(frame.sound.tuning, note.endPitch)));
        if (crossing) report.tuningTransitionGlides++; else report.offNativeGrid++;
      }
      if (note.part === 'percussion' && note.expression?.sourceId === 'reference:quarter') {
        report.rhythm.referenceAttacks++; if (note.tick % PPQ) report.rhythm.referenceOffQuarter++;
      } else if (note.id.startsWith('score:')) {
        report.rhythm.sourceAttacks++; if (note.tick % PPQ) report.rhythm.offQuarterSourceAttacks++;
      }
      if (note.id.startsWith('transition:')) report.rhythm.transitionAttacks++;
    }
    if (pitched.length && frame.form && !sections.has(frame.form.sectionIndex)) {
      sections.add(frame.form.sectionIndex); report.form.heardSections++;
      add(report.form.roles, [frame.form.role]); add(report.form.entries, [frame.form.behavior?.entry ?? 'flow']);
    }
    for (const layer of frame.phrase?.composition?.layers ?? []) {
      if (layer.role === 'counter' && layer.coverage) entries.set(`${layer.id}:${layer.cycleStartTick}`, { layer, tuning: frame.sound.tuning });
      if (layer.role === 'rhythm' && layer.active && !rhythmicLayers.has(`${layer.id}:${layer.cycleStartTick}`)
        && frame.notes.some(note => note.expression?.sourceId === layer.sourceId)) {
        rhythmicLayers.add(`${layer.id}:${layer.cycleStartTick}`); add(report.rhythm.layers, [layer.id === 'reference-pulse' ? 'reference' : layer.id.endsWith(':response') ? 'response' : 'riff']);
      }
    }
  }
  for (const { layer, tuning: native } of entries.values()) {
    const themeId = layer.sourceId.split(':')[0], core = sourceFor(themeId), head = core.clauses[0].notes;
    const heard = notes.filter(note => note.id.startsWith('counter:') && note.voice === 8
      && note.tick >= layer.cycleStartTick && note.tick < layer.cycleEndTick).sort((a, b) => a.tick - b.tick);
    if (layer.cycleEndTick > end || heard.length !== head.length) { report.counterpoint.unheardEntries++; continue; }
    const field = lyricalField(native, core.third), period = TUNINGS[native].divisions;
    const source = head.map(note => field[mod(note.degree, field.length)] + Math.floor(note.degree / field.length) * period);
    const actual = heard.map(note => pitchToDegree(native, note.absolutePitch!));
    const correlation = actual.slice(1).reduce((sum, value, index) => sum + (value - actual[index]) * (source[index + 1] - source[index]), 0);
    const used = correlation === 0 ? [] : [correlation < 0 ? 'contrary development' : 'imitation'];
    if (!same(used, layer.coverage!.used)) violation(`Counterpoint label differs from heard motion: ${layer.cycleStartTick}`);
    credit(report.counterpoint, used, layer.coverage);
  }
  const routes = new Map<string, Frame[]>();
  for (const frame of frames) if (frame.diagnostics.harmonicPlan) {
    const id = frame.diagnostics.harmonicPlan.routeId, prior = routes.get(id) ?? []; prior.push(frame); routes.set(id, prior);
  }
  for (const route of routes.values()) {
    const plan = route[0].diagnostics.harmonicPlan!;
    if (!plan.destinations.every(destination => destination.endTick <= end && route.some(frame =>
      frame.diagnostics.harmonicPlan!.current.id === destination.id && frame.diagnostics.harmonicPlan!.realization.matched
      && notes.some(note => (note.part === 'harmony' || note.part === 'bass') && note.tick < frame.tick + frame.duration
        && note.tick + note.duration > frame.tick)))) { report.harmony.incompleteOrUnheardRoutes++; continue; }
    credit(report.harmony, plan.tools ?? [], plan.coverage);
  }
  return report;
}

export function auditToolCoverage(recipe: Performance, frameCount = 320): ToolCoverageAudit {
  if (!Number.isSafeInteger(frameCount) || frameCount < 1 || frameCount > 8192) throw new RangeError('Audit frames must be between 1 and 8192.');
  const engine = new MusicEngine({ seed: recipe.seed, parameters: recipe.initialParameters, sound: recipe.sound,
    conductor: recipe.conductor, phrasing: recipe.phrasing, automation: recipe.automation,
    automationRevisions: recipe.automationRevisions, weights: recipe.weights });
  return toolCoverageFromFrames(recipe.seed, Array.from({ length: frameCount }, () => engine.step()));
}

/** A declared broad developmental context. It widens opportunities without
 * forcing every operation into a thought or weakening native feasibility. */
export function developmentalCoverageRecipe(seed: string, tuning: TuningId): Performance {
  const recipe = createPerformance(seed);
  recipe.conductor = { ...MANUAL_CONDUCTOR };
  recipe.sound = { ...recipe.sound, tuning, instrument: 'ensemble' };
  recipe.initialParameters = { ...recipe.initialParameters, ideaDensity: .72, melodicActivity: .78,
    motifTransformation: 1, melodicFamiliarity: .3, motifRecurrence: .15, rhythmicDensity: .72,
    rhythmicComplexity: .78, rhythmicPredictability: .28, ensembleSize: .76, dissonance: .16 };
  recipe.phrasing!.composition = { ...recipe.phrasing!.composition!, development: 1, dynamicRange: 0, displacement: 1, polymeter: .7 };
  recipe.phrasing!.harmony = { ...recipe.phrasing!.harmony!, strategy: 'balanced', treatment: 'develop' };
  return recipe;
}

/** Separate delivery study: large expressive changes and explicitly enabled
 * pitch ramps admit ornate crests while quieter passages retain their space. */
export function ornamentalCoverageRecipe(seed: string): Performance {
  const recipe = developmentalCoverageRecipe(seed, '12tet');
  recipe.conductor = { ...recipe.conductor!, enabled: true, amount: .7, tuningTravel: true };
  recipe.initialParameters = { ...recipe.initialParameters, ideaDensity: .55, melodicActivity: .85, rhythmicDensity: .9 };
  recipe.phrasing!.composition = { ...recipe.phrasing!.composition!, dynamicRange: .8, embellishment: 1 };
  recipe.phrasing!.variation = 1;
  return recipe;
}
