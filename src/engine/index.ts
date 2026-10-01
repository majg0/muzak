import { FRAME_TICKS, type AutomationLane, type AutomationRevision, type EngineConfig, type Frame, type FrameDiagnostics, type Motif, type NoteEvent, type Parameters, type ScoreWeights } from '../types';
import { DEFAULT_WEIGHTS } from '../parameters';
import { clamp, estimatedCenter, round } from './analysis';
import { plan, PLANNING_HORIZON, type HarmonicState } from './planner';
import { integer, random } from './random';
import { degreeToPitch, midiToPitch, pitchToDegree, pitchToMidi, type Pitch, type TuningId } from '../pitch';
import { DEFAULT_SOUND, type SoundConfig } from '../spectrum';
import { createRoughnessScorer, type RoughnessScorer } from './roughness-scoring';
import { nativeFieldFit, initialNativeState, planNativeEdo, type NativeEdoState } from './native-edo';
import { nativeClass } from './native-space';
import type { ConductorConfig, FormState } from '../conductor';
import { grooveNotes, grooveLayersAt } from './groove';
import { absoluteFromNative, projectSonority } from './tuning-transition';
import type { PlanningIntent } from './intent';
import { PhraseLayer, clipPhraseRests } from './phrase';
import { melodySupport12, melodySupportNative } from './melody-support';
import type { CompositionConfig } from '../composition';
import { CounterpointLayer } from './counterpoint';
import { planTransitions, type TransitionBoundary, type TransitionPlan } from './transitions';
import { ExpressiveGlides } from './expressive-glides';
import { OrchestrationObserver } from './orchestration-observer';
import { realizeEnsembleFills } from './ensemble-fill';
import { applyEnsembleDynamics } from './ensemble';
import type { TextureIntent } from './texture';
import { SoundingHarmony } from './sounding-harmony';
import { harmonicDestinationAt, harmonicRealization } from './harmonic-tools';
import { ScoreTimeline } from './score-timeline';
import { HarmonicDirector } from './harmonic-director';
import { realizeArrangement } from './arrangement';

export { eventHash, hash32, random } from './random';
export { aggregateTension, dissonance, harmonicDistance, targetTension, validVoices, voiceLeadingDistance } from './analysis';

/** Pure musical state: no browser, clock, oscillator or execution-order RNG. */
export class MusicEngine {
  private readonly seed: string;
  private readonly timeline: ScoreTimeline;
  private automation: AutomationLane[];
  private automationRevisions: AutomationRevision[];
  private nextAutomationRevision = 0;
  private weights: ScoreWeights;
  private state: HarmonicState;
  private nativeState: NativeEdoState;
  private index = 0;
  private readonly sound: SoundConfig;
  private currentTuning: TuningId;
  private readonly conductor: ConductorConfig;
  private readonly homeTonic: number;
  private readonly phraseLayer: PhraseLayer;
  private readonly harmonicDirector: HarmonicDirector;
  private readonly composition: Required<CompositionConfig>;
  private readonly counterpoint: CounterpointLayer;
  private readonly expressiveGlides?: ExpressiveGlides;
  private readonly orchestrationObserver = new OrchestrationObserver();
  private readonly soundingHarmony = new SoundingHarmony();
  private readonly previousVoiceEnds = new Map<number, number>();
  private readonly sensory: RoughnessScorer;
  private memory: Motif[] = [];

  constructor(config: EngineConfig) {
    this.seed = String(config.seed);
    this.sound = structuredClone(config.sound ?? DEFAULT_SOUND);
    this.currentTuning = this.sound.tuning;
    this.timeline = new ScoreTimeline(config);
    this.conductor = this.timeline.profile.conductor;
    this.sensory = createRoughnessScorer(this.sound, pitch => this.toAbsolutePitch(pitch));
    this.automation = structuredClone(config.automation ?? []);
    this.automationRevisions = structuredClone(config.automationRevisions ?? []).sort((a, b) => a.tick - b.tick);
    this.weights = { ...DEFAULT_WEIGHTS, ...config.weights };
    const center = integer(this.seed, 'initial', 0, 11, 'center');
    this.homeTonic = center;
    const phrasing = this.timeline.profile.phrasing;
    this.composition = phrasing.composition;
    this.phraseLayer = new PhraseLayer(this.seed, phrasing, center, {
      formAt: tick => this.formAt(tick), amount: this.composition.dynamicRange,
      glidesEnabled: this.conductor.tuningTravel && this.sound.instrument === 'ensemble',
      textureAt: tick => this.textureAt(tick), expressionAt: (tick: number) => this.timeline.at(tick).expression,
    });
    this.harmonicDirector = new HarmonicDirector(this.seed, phrasing.harmony, this.phraseLayer, this.timeline);
    this.counterpoint = new CounterpointLayer(this.seed, this.composition, center, tick => this.formAt(tick));
    if (this.conductor.tuningTravel && this.sound.instrument === 'ensemble') this.expressiveGlides = new ExpressiveGlides(this.seed);
    const shift = center <= 6 ? center : center - 12;
    // Initial register placement; the thematic plan supplies destinations and
    // the bounded voicing search connects them.
    this.state = { voices: [55, 60, 64, 69].map(n => n + shift), bass: 36 + center, center, index: 0, recent: [] };
    this.nativeState = initialNativeState(this.seed, this.currentTuning === '12tet' ? '19edo' : this.currentTuning);
  }

  private toAbsolutePitch(nativePitch: number): Pitch { return absoluteFromNative(nativePitch, this.currentTuning); }
  private pitchedFields(nativePitch: number): Pick<NoteEvent, 'absolutePitch' | 'midiNote'> {
    return this.currentTuning !== '12tet' ? { absolutePitch: this.toAbsolutePitch(nativePitch) } : { absolutePitch: this.toAbsolutePitch(nativePitch), midiNote: nativePitch };
  }
  private formAt(tick: number): FormState { return this.timeline.formAt(tick); }
  private parametersAt(index: number): Parameters { return this.timeline.parametersAt(index); }
  private textureAt(tick: number): TextureIntent { return this.timeline.textureAt(tick); }

  private transitionsAt(tick: number, form: FormState, lookAhead = 3840 + FRAME_TICKS): TransitionPlan[] {
    if (this.composition.transition === 0) return [];
    const boundaries: TransitionBoundary[] = [];
    for (const boundary of [form.sectionStartTick, form.sectionEndTick]) {
      if (boundary <= 0 || boundary < tick - 4320 || boundary > tick + lookAhead) continue;
      const before = this.formAt(boundary - 1), after = this.formAt(boundary);
      const changedMeter = before.meter.numerator !== after.meter.numerator || before.meter.denominator !== after.meter.denominator;
      boundaries.push({ id: `section-${after.sectionIndex}`, tick: boundary, themeId: before.themeId, kind: changedMeter ? 'meter' : 'section',
        strength: after.role === 'breakdown' || after.role === 'intro' ? .45 : after.role === 'climax' ? 1 : .8 });
    }
    // Only presently known automation may announce a tempo destination.
    // Frame commits are the actual points at which playback receives BPM.
    const tempo = this.automation.find(lane => lane.parameter === 'tempo');
    for (let index = 0; index < (tempo?.points.length ?? 0); index++) {
      const point = tempo!.points[index];
      const boundary = Math.ceil(point.tick / FRAME_TICKS) * FRAME_TICKS;
      if (boundary <= 0 || boundary < tick - 4320 || boundary > tick + lookAhead
        || boundaries.some(item => item.kind === 'tempo' && item.tick === boundary)) continue;
      // Several edits can lie between two frame commits. Announce only a
      // change the transport will actually play, not an unsampled waypoint.
      const indexAtBoundary = boundary / FRAME_TICKS;
      if (Math.abs(this.parametersAt(indexAtBoundary).tempo - this.parametersAt(indexAtBoundary - 1).tempo) < 2) continue;
      boundaries.push({ id: `tempo-${boundary}`, tick: boundary, themeId: this.formAt(boundary - 1).themeId, kind: 'tempo', strength: .9 });
    }
    return boundaries.flatMap(boundary => planTransitions(this.seed, boundaries,
      this.parametersAt(Math.floor(Math.max(0, boundary.tick - 3840) / FRAME_TICKS)), this.composition!.transition).filter(plan => plan.boundaryTick === boundary.tick))
      .sort((a, b) => a.boundaryTick - b.boundaryTick || (a.kind < b.kind ? -1 : 1))
      .filter((plan, index, plans) => !plans.slice(index + 1).some(other => other.boundaryTick === plan.boundaryTick))
      // Long expressive holds must know the next already-declared breath
      // before their onset is committed. Publishing a future rest is safe;
      // transition attacks are still emitted only in their own frame.
      .filter(plan => plan.startTick < tick + lookAhead && plan.endTick > tick);
  }

  private switchTuning(target: TuningId): { voices: Pitch[]; bass: Pitch } {
    const previous = this.currentTuning !== '12tet'
      ? { voices: this.nativeState.upperDegrees.map(degree => degreeToPitch(this.currentTuning, degree)), bass: degreeToPitch(this.currentTuning, this.nativeState.bassDegree) }
      : { voices: this.state.voices.map(midiToPitch), bass: midiToPitch(this.state.bass) };
    const next = projectSonority(previous.voices, previous.bass, target);
    this.currentTuning = target;
    if (target !== '12tet') this.nativeState = { upperDegrees: next.upper, bassDegree: next.bass, centerDegree: nativeClass(pitchToDegree(target, midiToPitch(60 + this.homeTonic)), target), index: this.index, recent: [] };
    else this.state = { voices: next.upper, bass: next.bass, center: this.homeTonic, index: this.index, recent: [] };
    return previous;
  }

  private planningIntent(index: number, p: Parameters): PlanningIntent {
    return this.harmonicDirector.intentAt(index, p, this.currentTuning);
  }

  get tick(): number { return this.index * FRAME_TICKS; }

  setParameters(parameters: Parameters): void { this.timeline.setParameters(parameters); }
  setAutomation(lanes: AutomationLane[], revisions: AutomationRevision[] = []): void {
    this.automation = structuredClone(lanes);
    this.automationRevisions = structuredClone(revisions).sort((a, b) => a.tick - b.tick);
    this.nextAutomationRevision = 0;
    this.timeline.setAutomation(lanes);
  }
  setWeights(weights: Partial<ScoreWeights>): void { this.weights = { ...this.weights, ...weights }; }

  step(): Frame {
    const tick = this.tick;
    // A replay must know only the trajectories that were known to the live
    // planner at this commit boundary. Future edits must not leak backward
    // through the planning horizon and alter already-performed events.
    while (this.nextAutomationRevision < this.automationRevisions.length && this.automationRevisions[this.nextAutomationRevision].tick <= tick) {
      this.automation = structuredClone(this.automationRevisions[this.nextAutomationRevision++].lanes);
      this.timeline.setAutomation(this.automation);
    }
    const form = this.formAt(tick);
    const transition = form && form.tuning !== this.currentTuning ? this.switchTuning(form.tuning) : undefined;
    const p = this.parametersAt(this.index);
    // Each orchestral layer reads the same continuous performance intent.
    // This is evaluated at its actual attack, not reset at each melodic cell.
    const textureAt = (at: number) => this.textureAt(at);
    const transitionPlans = this.transitionsAt(tick, form);
    this.phraseLayer.begin(form, p);
    const parametersAt = (index: number) => this.parametersAt(index);
    const intentAt = (index: number, parameters: Parameters) => this.planningIntent(index, parameters);
    let voices: number[], bass: number, diagnostics: FrameDiagnostics;
    const memoryDiagnostics = { horizon: PLANNING_HORIZON, section: form?.sectionIndex ?? Math.floor(this.index / 32), phrase: form?.phraseIndex ?? Math.floor(this.index / 8) };
    if (this.currentTuning !== '12tet') {
      if (form && ['intro', 'theme', 'return', 'breakdown'].includes(form.role)) this.nativeState.centerDegree = nativeClass(pitchToDegree(this.currentTuning, midiToPitch(60 + this.homeTonic + (form.tonalOffsetCents ?? 0) / 100)), this.currentTuning);
      const { winner, evaluated } = planNativeEdo(this.currentTuning, this.seed, this.nativeState, parametersAt, this.weights, this.sensory, intentAt);
      voices = winner.state.upperDegrees;
      bass = winner.state.bassDegree;
      diagnostics = { ...memoryDiagnostics, harmonicTension: winner.harmonicTension, tonalCenterDegree: winner.state.centerDegree, clarity: nativeFieldFit(voices, bass, winner.state.centerDegree, this.currentTuning), voiceLeadingCents: winner.movementCents / 4, harmonicDistance: winner.distance, dissonance: winner.dissonance, actualTension: winner.actual, targetTension: winner.target, tension: { ...winner.tension }, scores: { ...winner.scores }, totalScore: winner.total, candidatesEvaluated: evaluated };
      this.nativeState = winner.state;
    } else {
      const { winner, evaluated } = plan(this.seed, this.state, parametersAt, this.weights, this.sensory, intentAt);
      voices = winner.state.voices;
      bass = winner.state.bass;
      const estimate = estimatedCenter(voices, bass, winner.state.center, form && this.conductor.enabled ? this.phraseLayer?.homeThird(form) : undefined);
      diagnostics = { ...memoryDiagnostics, harmonicTension: winner.harmonicTension, tonalCenter: estimate.center, clarity: estimate.clarity, voiceLeadingCents: winner.movement * 25, harmonicDistance: winner.distance, dissonance: winner.intervallicFriction, actualTension: winner.actual, targetTension: winner.target, tension: { ...winner.tension }, scores: { ...winner.scores }, totalScore: winner.total, candidatesEvaluated: evaluated };
      this.state = winner.state;
    }
    const supportTargets = this.phraseLayer?.harmonicTargets(tick) ?? [];
    const harmonicRoute = this.harmonicDirector.routeAt(tick, this.currentTuning), harmonicDestination = harmonicRoute && harmonicDestinationAt(harmonicRoute, tick);
    if (harmonicRoute && harmonicDestination) diagnostics.harmonicPlan = {
      routeId: harmonicRoute.id, current: structuredClone(harmonicDestination), destinations: structuredClone(harmonicRoute.destinations),
      realization: harmonicRealization(harmonicDestination, voices, bass, this.currentTuning),
      tools: harmonicRoute.tools && [...harmonicRoute.tools],
      coverage: harmonicRoute.coverage && structuredClone(harmonicRoute.coverage),
      evaluation: harmonicRoute.evaluation && { ...harmonicRoute.evaluation }, candidatesEvaluated: harmonicRoute.candidatesEvaluated,
    };
    if (supportTargets.length) diagnostics.melodicSupport = this.currentTuning !== '12tet' ? melodySupportNative(voices, bass, supportTargets, this.currentTuning) : melodySupport12(voices, bass, supportTargets);
    if (this.sensory.applicable) {
      const sensoryResult = this.sensory.evaluate([...voices, bass], this.index);
      diagnostics.sensoryRoughness = sensoryResult.value;
      diagnostics.roughnessTarget = sensoryResult.target;
      diagnostics.roughnessContribution = sensoryResult.contribution;
    }
    const expressive = form ? (0.45 + p.dynamics * 0.7) * (form.beat === 1 ? 1 : 0.9) : 1;
    let notes: NoteEvent[] = voices.map((pitch, voice) => ({ id: `${this.index}:h:${voice}`, tick, duration: FRAME_TICKS + 30, ...this.pitchedFields(pitch), velocity: round(clamp((0.34 + p.dynamics * 0.3 + random(this.seed, 'velocity', 'harmony', this.index, voice) * 0.055) * (voice % 2 === 0 ? 0.82 + p.texturalDensity * 0.18 : 0.50 + p.texturalDensity * 0.5) * expressive)), part: 'harmony', voice, ...(form ? { timbre: form.instrument } : {}) }));
    const referenceBass: NoteEvent = { id: `${this.index}:b`, tick, duration: Math.round(FRAME_TICKS * (0.78 + p.voiceLeading * 0.15)), ...this.pitchedFields(bass), velocity: round((0.45 + p.dynamics * 0.27) * expressive), part: 'bass', voice: 4, ...(form ? { timbre: 'round' as const } : {}) };
    const groove = grooveNotes(this.seed, tick, FRAME_TICKS, at => this.formAt(at), p, this.currentTuning, bass, voices[0], native => this.toAbsolutePitch(native),
      { composition: this.composition, transitionPlans, textureAt,
        harmonyAt: () => ({ bass: this.toAbsolutePitch(bass), voices: voices.map(voice => this.toAbsolutePitch(voice)) }) });
    notes.push(...groove.filter(note => note.part !== 'bass' || this.sound.instrument !== 'additive' && !transition));
    if (this.sound.instrument === 'additive' || transition) notes.push({ ...referenceBass, duration: FRAME_TICKS + 30 });
    if (transition) {
      for (const note of notes) if (note.part === 'harmony' || note.part === 'bass') {
        note.endPitch = note.absolutePitch;
        note.absolutePitch = note.part === 'harmony' ? transition.voices[note.voice] : transition.bass;
        note.glideTicks = Math.min(note.duration, 768);
        delete note.midiNote;
      }
    }
    {
      const planned = { voices: voices.map(pitch => this.toAbsolutePitch(pitch)), bass: this.toAbsolutePitch(bass) };
      const preview = this.phraseLayer.previewBacking(notes, tick, FRAME_TICKS, this.sound.instrument === 'additive', referenceBass);
      const rests = [...(this.phraseLayer.snapshot()?.rests ?? []), ...transitionPlans.flatMap(plan => plan.rests)];
      const harmonyAt = this.soundingHarmony.at(preview, rests, planned);
      notes.push(...this.phraseLayer.notes(tick, FRAME_TICKS, this.currentTuning, planned.voices, planned.bass, this.sound.instrument === 'additive', harmonyAt));
      notes = this.phraseLayer.shape(notes, tick, FRAME_TICKS, this.sound.instrument === 'additive', referenceBass);
      this.memory = this.phraseLayer.motifs(this.currentTuning);
      const snapshot = this.phraseLayer.snapshot()!;
      diagnostics.recall = snapshot.relationship === 'first statement' ? undefined : { motifId: snapshot.themeId, transformation: snapshot.relationship };
    }
    const phraseSnapshot = this.phraseLayer?.snapshot();
    if (phraseSnapshot && transitionPlans.length) phraseSnapshot.rests.push(...transitionPlans.flatMap(plan => plan.rests));
    // A shared riff breath applies to backing; foreground clause breaths
    // retain their own clock. Publish it before committing long note tails.
    if (phraseSnapshot && this.sound.instrument !== 'additive') phraseSnapshot.rests.push(...(textureAt(tick).rhythm?.rests ?? [])
      .map(rest => ({ ...rest, scope: 'accompaniment' as const, reason: 'Shared riff breath.' })));
    if (this.sound.instrument !== 'additive') {
      // Foreground breaths name their own voices. This line keeps its clock
      // and note tails through those breaths, while shared rests still win.
      const sounding = this.soundingHarmony.events(notes, phraseSnapshot?.rests ?? []);
      notes.push(...clipPhraseRests(this.counterpoint.notes(tick, FRAME_TICKS, p, this.currentTuning, textureAt, phraseSnapshot?.themeCore,
        { notes: sounding }), phraseSnapshot?.rests ?? [], Number.MAX_SAFE_INTEGER));
      if (phraseSnapshot?.composition) phraseSnapshot.composition.layers = [this.counterpoint.snapshot(tick)];
    }
    if (phraseSnapshot) {
      const filled = realizeEnsembleFills(notes, { seed: this.seed, tick, duration: FRAME_TICKS, plans: transitionPlans,
        parameters: p, tuning: this.currentTuning, additive: this.sound.instrument === 'additive', textureAt,
        templates: voices.map((pitch, voice) => ({ id: `${this.index}:fill-template:${voice}`, tick, duration: FRAME_TICKS,
          ...this.pitchedFields(pitch), voice, part: 'harmony', timbre: form?.instrument, velocity: .3 + p.dynamics * .35 })),
        bassTemplate: referenceBass, rests: phraseSnapshot.rests, previousVoiceEnds: this.previousVoiceEnds, cohesion: this.composition.cohesion });
      notes = filled.notes;
      if (phraseSnapshot.composition) phraseSnapshot.composition.fills = filled.fills;
      // Long held destinations can outlive the fill's bounded scheduling
      // window. Clip against every already-known breath their tails reach
      // now, before storing/exporting the event. Future live edits are still
      // unknown and never retroactively rewrite committed history.
      const tail = Math.max(tick + FRAME_TICKS, ...notes.map(note => note.tick + note.duration));
      const tailRests = this.transitionsAt(tick, form, Math.max(3840 + FRAME_TICKS, tail - tick))
        .flatMap(plan => plan.rests);
      for (const rest of tailRests) if (!phraseSnapshot.rests.some(existing => existing.startTick === rest.startTick
        && existing.endTick === rest.endTick && existing.scope === rest.scope)) phraseSnapshot.rests.push(rest);
      notes = clipPhraseRests(notes, tailRests, Number.MAX_SAFE_INTEGER);
      if (phraseSnapshot.composition) {
        phraseSnapshot.composition.layers = [...(phraseSnapshot.composition.layers ?? []), ...grooveLayersAt(tick, textureAt(tick).rhythm!)];
        const approach = transitionPlans.find(plan => plan.boundaryTick >= tick) ?? transitionPlans.at(-1);
        if (approach) phraseSnapshot.composition.transition = { boundaryTick: approach.boundaryTick, startTick: approach.startTick, endTick: approach.endTick,
          kind: approach.gesture, reason: approach.kind, energy: approach.energy };
      }
    }
    const arranged = realizeArrangement(notes, { seed: this.seed, tick, duration: FRAME_TICKS,
      additive: this.sound.instrument === 'additive', parametersAt: at => this.timeline.at(at).parameters,
      ...(phraseSnapshot?.themeCore?.notes.length ? { melodyRangeMillicents: [
        Math.round(Math.min(...phraseSnapshot.themeCore.notes.map(note => note.absolutePitchCents)) * 1000),
        Math.round(Math.max(...phraseSnapshot.themeCore.notes.map(note => note.absolutePitchCents)) * 1000),
      ] as const } : {}),
      formAt: at => this.formAt(at), textureAt,
      upper: voices.map((pitch, voice) => ({ id: `${this.index}:orchestra:${voice}`, tick, duration: FRAME_TICKS,
        ...this.pitchedFields(pitch), voice, part: 'harmony', velocity: .34 + p.dynamics * .3 })) });
    notes = arranged.notes;
    diagnostics.arrangement = arranged.diagnostic;
    if (phraseSnapshot) {
      phraseSnapshot.rests.push(...arranged.rests);
      notes = clipPhraseRests(notes, phraseSnapshot.rests, Number.MAX_SAFE_INTEGER);
    }
    notes = applyEnsembleDynamics(notes,
      this.timeline.at(tick).expression.intensity, this.composition.dynamicRange, this.sound.instrument === 'additive', textureAt);
    if (this.expressiveGlides) notes = this.expressiveGlides.apply(notes, p, phraseSnapshot?.rests ?? [],
      phraseSnapshot?.themeCore ? { sourceId: phraseSnapshot.themeCore.id,
        startTick: phraseSnapshot.startTick, endTick: phraseSnapshot.endTick } : undefined);
    this.soundingHarmony.commit(notes, phraseSnapshot?.rests ?? [], tick + FRAME_TICKS);
    for (const note of notes) if (note.part === 'melody') this.previousVoiceEnds.set(note.voice,
      Math.max(this.previousVoiceEnds.get(note.voice) ?? 0, note.tick + note.duration));
    const moment = this.timeline.at(tick);
    diagnostics.compositionExpression = { ...moment.expression, ...moment.texture };
    diagnostics.orchestration = this.orchestrationObserver.measure(notes, tick, FRAME_TICKS, this.timeline.at(tick).expression.energy, phraseSnapshot?.rests);
    notes.sort((a, b) => a.tick - b.tick || a.voice - b.voice || (a.absolutePitch?.millicents ?? (a.midiNote ?? 0) * 100000) - (b.absolutePitch?.millicents ?? (b.midiNote ?? 0) * 100000));
    const frame: Frame = {
      index: this.index, tick, duration: FRAME_TICKS, voicePitches: voices.map(pitch => this.toAbsolutePitch(pitch)), bassPitch: this.toAbsolutePitch(bass), sound: { ...structuredClone(this.sound), tuning: this.currentTuning }, notes, parameters: { ...p }, diagnostics, ...(form ? { form: structuredClone(form) } : {}),
      motifs: this.memory.map(m => ({ ...m, intervals: [...m.intervals], rhythm: [...m.rhythm] })),
      ...(phraseSnapshot ? { phrase: phraseSnapshot } : {}),
    };
    this.index++;
    return frame;
  }
}
