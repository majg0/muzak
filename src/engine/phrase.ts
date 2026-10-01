import { themeIds, type FormState, type InstrumentColor } from '../conductor';
import { degreeToPitch, midiToPitch, pitchToDegree, pitchToMidi, TUNINGS, type Pitch, type TuningId } from '../pitch';
import { restAppliesToNote, type PhraseConfig, type PhraseEnvelope, type PhraseRest, type PhraseSnapshot, type RememberedIdea } from '../phrasing';
import { FRAME_TICKS, type Motif, type NoteEvent, type Parameters } from '../types';
import { clamp, round } from './analysis';
import { random } from './random';
import { resolveCompositionProfile, type CompositionProfile } from '../composition-profile';
import { coordinateEnsemble } from './ensemble';
import { expressiveContourAt, type ExpressiveContour } from './expression';
import { realizeAccompaniment } from './accompaniment';
import { clipGainEnvelope } from '../note-expression';
import { textureIntentAt, type TextureIntent, type TextureAt } from './texture';
import { planLyricalSentence } from './lyrical';
import { composeThemeCore, realizeThemeCore, themeDevelopment, themeThird, type ThemeCore, type ThemeCoreSnapshot } from './theme-core';
import { realizeThemeDelivery, type DeliveredThemeNote } from './theme-realization';
import { harmonicSequenceOffset } from './harmonic-tools';
import { planThoughtSpans } from './thought-spans';
import { lyricalField } from './lyrical-support';

interface Idea extends RememberedIdea {
  cents: number[]; positions: number[]; anchor: boolean; third: 3 | 4;
  bornTick: number; lastHeardTick: number; familyId: string; answerCents: number[];
}
interface Cell {
  idea: Idea; start: number; end: number; label: string;
  notes: DeliveredThemeNote[]; statement: 'question' | 'answer';
}
interface Intent {
  id: string; startTick: number; endTick: number; ordinal: number; cadence: 'open' | 'closed';
}
interface Section { id: string; form: FormState; phrases: Intent[]; }
interface Plan {
  snapshot: PhraseSnapshot; cells: Cell[]; form: FormState; parameters: Parameters; intent: Intent;
  baseCents: number; timbre: InstrumentColor;
  context: { themeId: string; occurrence: number; harmonyOccurrence: number; third: 3 | 4; tonic: number; regionOffsetDegrees: number };
}

/** The archive starts with the same composed sources the foreground
 * actually uses. There is no second random melodic generator behind memory. */
export function seedIdea(seed: string, id: string): Idea {
  const familyId = id, third = themeThird(seed, familyId);
  const core = composeThemeCore(seed, familyId, third);
  const source = realizeThemeCore(core, { startTick: 0, endTick: 15360, tuning: '12tet', occurrence: 0, cadence: 'closed', treatment: 'reharmonize' });
  return { id: familyId, familyId, name: familyId.replace(/^theme-/, '').toUpperCase() + ' · ' + core.contour + ' subject',
    bornPhrase: 0, lastHeardPhrase: -1, uses: 0, role: 'theme', anchor: true, third, bornTick: 0, lastHeardTick: -1,
    cents: source.notes.map(note => note.cents), positions: source.notes.map(note => note.tick / 1920),
    answerCents: source.segments.filter(segment => segment.role === 'answer').flatMap(segment => segment.notes.map(note => note.cents)),
    signature: source.segments[0].notes.map(note => note.degree + 1).join(' · '), contour: core.name, lineage: core.id };
}

function nativePitch(cents: number, tuning: TuningId): Pitch {
  return degreeToPitch(tuning, pitchToDegree(tuning, { millicents: Math.round(cents * 1000) }));
}

/** The stored event, export and synthesis share the same intentional silence. */
export function clipPhraseRests(notes: readonly NoteEvent[], rests: readonly PhraseRest[], phraseEnd: number): NoteEvent[] {
  return notes.flatMap(original => {
    const note = { ...original };
    let end = Math.min(note.tick + note.duration, phraseEnd);
    for (const rest of rests) {
      if (!restAppliesToNote(note, rest)) continue;
      if (note.tick >= rest.startTick && note.tick < rest.endTick) return [];
      if (rest.startTick > note.tick && rest.startTick < end) end = rest.startTick;
    }
    note.duration = end - note.tick;
    if (note.duration <= 0) return [];
    if (note.gainEnvelope) note.gainEnvelope = clipGainEnvelope(note.gainEnvelope, note.duration);
    if (note.glideTicks && note.endPitch && note.absolutePitch && note.duration < note.glideTicks) {
      note.endPitch = { millicents: Math.round(note.absolutePitch.millicents
        + (note.endPitch.millicents - note.absolutePitch.millicents) * note.duration / note.glideTicks) };
      note.glideTicks = note.duration;
    }
    return [note];
  });
}

/** One pipeline: protected thematic argument → expressive delivery → common
 * accompaniment and ensemble coordination → audible memory. Every entry uses
 * the same source contract, including old recipes with disabled flags. */
export class PhraseLayer {
  private readonly config: CompositionProfile['phrasing'];
  private readonly composition: CompositionProfile['phrasing']['composition'];
  private archive: Idea[];
  private plan?: Plan;
  private section?: Section;
  private heard: NoteEvent[] = [];
  private used = false;
  private readonly themeCores = new Map<string, ThemeCore>();
  private readonly occurrences = new Map<string, number>();
  private readonly harmonicOccurrences = new Map<string, number>();
  private previousAnchor?: { pitch: Pitch; end: number };

  constructor(private readonly seed: string, config: PhraseConfig, private readonly tonic: number,
    private readonly expressionContext?: { formAt: (tick: number) => FormState; amount: number; glidesEnabled?: boolean;
      textureAt?: TextureAt; expressionAt?: (tick: number) => ExpressiveContour }) {
    this.config = resolveCompositionProfile({ phrasing: config }).phrasing;
    this.composition = this.config.composition;
    this.archive = themeIds(seed).map(id => seedIdea(seed, id));
  }

  private expressiveAt(tick: number): ExpressiveContour {
    return this.expressionContext?.expressionAt?.(tick) ?? expressiveContourAt(this.seed, Math.max(0, Math.round(tick)),
      this.expressionContext?.formAt ?? (() => this.section!.form), this.expressionContext?.amount ?? 0);
  }

  textureAt(tick: number): TextureIntent {
    return this.expressionContext?.textureAt?.(tick)
      ?? textureIntentAt(this.plan!.parameters, this.plan!.form, this.expressiveAt(tick));
  }

  private finishPhrase(): void {
    if (!this.plan || !this.heard.length) return;
    const anchor = this.plan.cells[0].idea, heard = this.heard.filter(note => note.expression?.role === 'anchor').slice(0, 32);
    if (heard.length >= 3 && random(this.seed, 'heard-theme', this.plan.snapshot.phraseId, 'discover') < this.config.renewal) {
      const first = heard[0], cents = heard.map(note => (note.absolutePitch!.millicents - first.absolutePitch!.millicents) / 1000);
      const positions = heard.map(note => (note.tick - first.tick) / 1920);
      const existing = this.archive.find(idea => !idea.anchor && idea.familyId === anchor.familyId && idea.cents.length === cents.length
        && idea.cents.every((value, index) => Math.abs(value - cents[index]) < 1)
        && idea.positions.every((value, index) => Math.abs(value - positions[index]) < .001));
      if (existing) { existing.uses++; existing.lastHeardTick = heard.at(-1)!.tick; existing.lastHeardPhrase = this.plan.snapshot.phraseId; }
      else this.archive.push({ ...anchor, id: `heard-${this.plan.snapshot.phraseId}`, sourceId: anchor.id, anchor: false,
        name: `${anchor.familyId.slice(-1).toUpperCase()} · Heard variation ${this.plan.snapshot.phraseId + 1}`,
        cents, positions, answerCents: [...cents], bornPhrase: this.plan.snapshot.phraseId, lastHeardPhrase: this.plan.snapshot.phraseId,
        bornTick: first.tick, lastHeardTick: heard.at(-1)!.tick, uses: 1, contour: `an actually heard ${heard.length}-note thematic argument`,
        lineage: `heard from ${anchor.name}` });
    }
    if (this.archive.length > 18) {
      const sources = this.archive.filter(idea => idea.anchor);
      const remembered = this.archive.filter(idea => !idea.anchor).sort((a, b) => b.lastHeardTick - a.lastHeardTick || b.uses - a.uses)
        .slice(0, Math.max(0, 18 - sources.length));
      this.archive = [...sources, ...remembered];
    }
    this.heard = [];
    this.used = false;
  }

  begin(form: FormState, parameters: Parameters): void {
    const beat = 480 * 4 / form.meter.denominator;
    const now = Math.max(form.phraseStartTick, Math.round(form.barStartTick + (form.beat - 1) * beat));
    if (this.plan && this.plan.form.sectionIndex === form.sectionIndex && now < this.plan.snapshot.endTick) return;
    this.finishPhrase();
    let idea = this.archive.find(item => item.anchor && item.familyId === form.themeId);
    if (!idea) { idea = seedIdea(this.seed, form.themeId); this.archive.push(idea); }
    const core = this.themeCores.get(idea.familyId) ?? composeThemeCore(this.seed, idea.familyId, idea.third);
    this.themeCores.set(idea.familyId, core);
    if (!this.section || this.section.form.sectionStartTick !== form.sectionStartTick || this.section.form.sectionIndex !== form.sectionIndex) {
      const id = `section-${form.sectionIndex}`, phrases: Intent[] = [];
      const spans = planThoughtSpans(this.seed, form, core, parameters, this.composition.development, this.config.harmony.treatment);
      for (const [ordinal, span] of spans.entries()) {
        const { startTick, endTick } = span;
        phrases.push({ id: `${id}:theme-${ordinal}`, startTick, endTick, ordinal,
          cadence: endTick === form.sectionEndTick ? form.behavior?.ending
            ?? (['intro', 'development', 'answer'].includes(form.role) ? 'open' : 'closed') : 'open' });
      }
      this.section = { id, form: structuredClone(form), phrases };
    }
    const section = this.section, intent = section.phrases.find(item => now < item.endTick) ?? section.phrases.at(-1)!;
    const start = intent.startTick, end = intent.endTick;
    const occurrence = this.occurrences.get(idea.familyId) ?? 0;
    this.occurrences.set(idea.familyId, occurrence + 1);
    // Count actual opportunities in a stable context. A closed cadence every
    // eighth thought must not get stuck on the same vocabulary slot forever.
    const harmonicScope = `${form.tuning}:${intent.cadence}`;
    const harmonyOccurrence = this.harmonicOccurrences.get(harmonicScope) ?? 0;
    this.harmonicOccurrences.set(harmonicScope, harmonyOccurrence + 1);
    const harmony = this.config.harmony;
    const development = themeDevelopment(this.seed, idea.familyId, occurrence, idea.uses > 0, parameters);
    const regionOffsetDegrees = harmonicSequenceOffset(this.seed, idea.familyId, occurrence, form.tuning, harmony);
    const plannedForm = { ...structuredClone(form), phraseStartTick: start, phraseEndTick: end,
      tonalOffsetCents: regionOffsetDegrees * 1200 / TUNINGS[form.tuning].divisions };
    const textureAt: TextureAt = tick => this.expressionContext?.textureAt?.(tick)
      ?? textureIntentAt(parameters, plannedForm, this.expressiveAt(tick));
    const argumentExpression = this.expressiveAt(start), argumentRhythm = textureAt(start).rhythm;
    const sentence = planLyricalSentence({ seed: this.seed, themeId: idea.familyId, occurrence, startTick: start, endTick: end,
      barTicks: form.barTicks, beatTicks: beat, tuning: form.tuning, third: idea.third, parameters, cadence: intent.cadence,
      themeCore: core, treatment: harmony.treatment, development,
      argument: { seed: this.seed, ideaDensity: parameters.ideaDensity, activity: argumentExpression.activity,
        register: argumentExpression.register, intervalComplexity: parameters.intervalComplexity, familiarity: parameters.melodicFamiliarity,
        syncopation: parameters.rhythmicComplexity * (1 - parameters.metricStability * .65),
        ...(argumentRhythm ? { rhythm: argumentRhythm } : {}) } });
    // The source owns its register. Decoration cannot displace the whole tune
    // merely because one proposed neighbor would exceed its physical range.
    const minimum = Math.min(...sentence.notes.map(note => note.cents)), maximum = Math.max(...sentence.notes.map(note => note.cents));
    const homeBase = (60 + this.tonic) * 100 + plannedForm.tonalOffsetCents;
    const registerFreedom = harmony.treatment === 'develop' && !development.literal
      ? parameters.motifTransformation * (1 - parameters.melodicFamiliarity * .5) : 0;
    const register = .5 + (this.expressiveAt(start + Math.floor((end - start) / 2)).register - .5) * registerFreedom;
    // A whole-octave option must be reachable by a real crest. Range and
    // incoming-interval costs still reject unsupported register jumps.
    const desired = homeBase + (register - .5) * 4800;
    const options = [-1200, 0, 1200].map(offset => homeBase + offset)
      .filter(base => nativePitch(base + minimum, form.tuning).millicents >= 5200000
        && nativePitch(base + maximum, form.tuning).millicents <= 9600000);
    const firstCents = sentence.notes[0].cents;
    options.sort((a, b) => {
      const cost = (base: number) => Math.abs(base - desired) + (this.previousAnchor && harmony.treatment === 'develop'
        ? Math.max(0, Math.abs(base + firstCents - this.previousAnchor.pitch.millicents / 1000) - 500) * 2 : 0);
      return cost(a) - cost(b) || a - b;
    });
    const baseCents = options[0] ?? homeBase;
    const delivered = realizeThemeDelivery(sentence, { seed: this.seed, occurrence, tuning: form.tuning, third: idea.third,
      embellishment: this.composition.embellishment * (.65 + this.config.variation * .35)
        * (harmony.treatment === 'develop' ? .5 + parameters.motifTransformation : 1), textureAt, parameters,
      allowGlides: this.expressionContext?.glidesEnabled,
      pitchInRange: cents => { const pitch = nativePitch(baseCents + cents, form.tuning).millicents; return pitch >= 5200000 && pitch <= 9600000; } });
    const cells: Cell[] = delivered.segments.map(segment => ({ idea, start: segment.startTick, end: segment.endTick,
      label: segment.label, statement: segment.role, notes: segment.notes }));
    const divisions = TUNINGS[form.tuning].divisions;
    const nativeTonic = form.tuning === '12tet' ? Math.round(baseCents / 100) : pitchToDegree(form.tuning, nativePitch(baseCents, form.tuning));
    const tonic = ((nativeTonic % divisions) + divisions) % divisions;
    const texture = textureAt(start + Math.floor((end - start) / 2));
    const palette: InstrumentColor[] = parameters.ideaDensity > .6
      ? ['lead', 'keys', 'reed', 'brass', 'glass', 'pluck']
      : parameters.ideaDensity < .28 ? ['strings', 'flute', 'round', 'keys'] : ['strings', 'reed', 'flute', 'keys', 'glass'];
    // A source keeps a coherent patch for the complete thought. Density can
    // change the delivery family, never roulette the instrument per note.
    const timbre = palette[Math.min(palette.length - 1, Math.floor(random(this.seed, 'theme-instrument', idea.familyId,
      sentence.realization?.kind ?? 'singing') * palette.length))];
    const themeCore: ThemeCoreSnapshot = { id: core.id, name: core.name, grammar: core.grammar, headId: core.headId,
      treatment: harmony.treatment, occurrence, transpositionDegrees: regionOffsetDegrees,
      ...(sentence.realization ? { realization: { ...sentence.realization } } : {}),
      notes: delivered.anchors.map((note, index) => ({ id: `${intent.id}:note-${index}`, sourceId: note.sourceId,
        degree: note.degree, role: note.coreRole!, purpose: note.corePurpose!, startTick: note.tick, endTick: note.tick + note.duration,
        absolutePitchCents: nativePitch(baseCents + note.cents, form.tuning).millicents / 1000 })) };
    const envelopes: PhraseEnvelope[] = (['activity', 'intensity', 'register'] as const).map(key => {
      const points = [0, .25, .5, .75, 1].map(position => ({ position, value: this.expressiveAt(Math.round(start + (end - start) * position))[key] }));
      return { key, points, realized: points.map(point => ({ ...point })), spread: 0 };
    });
    const middle = (sentence.segments.find(segment => segment.role === 'answer')
      ?? sentence.segments[Math.floor(sentence.segments.length / 2)]).startTick;
    const ending = delivered.anchors.at(-1)!;
    const treatment = harmony.treatment === 'reharmonize' ? 'fixed thematic core, changing accompaniment'
      : harmony.treatment === 'sequence' ? 'same thematic core in a planned tonal region'
        : development.literal ? 'literal thematic return with expressive delivery' : 'identifying head with a developed continuation';
    const motifs = sentence.realization?.motifs?.map(motif => ({ ...motif, id: `${intent.id}:${motif.id}`,
      treatment: motif.relationship })) ?? sentence.segments.map((segment, index) => ({
      id: `${intent.id}:motif-${index}`, sourceId: segment.sourceId, startTick: segment.startTick,
      endTick: segment.endTick, treatment: segment.label }));
    const field = lyricalField(form.tuning, idea.third);
    const degreeCents = (degree: number) => (field[((degree % field.length) + field.length) % field.length]
      + Math.floor(degree / field.length) * divisions) * 1200 / divisions;
    const shortPhrases = sentence.realization?.phrases?.map(part => {
      const original = core.clauses.find(clause => clause.sourceId === part.sourceId)?.notes[0].degree ?? 0;
      return { id: `${intent.id}:${part.id}`, sourceId: part.sourceId, motifId: `${intent.id}:${part.motifId}`,
        startTick: part.startTick, endTick: part.endTick, cycleTicks: part.endTick - part.startTick,
        transpositionCents: Math.round((degreeCents(original + part.transpositionDegrees) - degreeCents(original)) * 1000) / 1000,
        intervalScale: part.intervalScale, coreNotes: part.coreNotes };
    }) ?? delivered.segments.map((segment, index) => ({ id: `${intent.id}:clause-${index}`, sourceId: segment.sourceId,
      motifId: (motifs.find(motif => segment.startTick >= motif.startTick && segment.startTick < motif.endTick) ?? motifs[0]).id,
      startTick: segment.startTick, endTick: segment.endTick, cycleTicks: segment.endTick - segment.startTick,
      transpositionCents: 0, intervalScale: 1, coreNotes: segment.notes.filter(note => note.core).length }));
    idea.cents = sentence.notes.map(note => note.cents);
    idea.positions = sentence.notes.map(note => (note.tick - start) / 1920);
    idea.answerCents = sentence.segments.filter(segment => segment.role === 'answer').flatMap(segment => segment.notes.map(note => note.cents));
    idea.signature = sentence.segments[0].notes.map(note => note.degree + 1).join(' · ');
    idea.contour = core.name; idea.lineage = `${core.id} · ${harmony.treatment} · native ${form.tuning}`;
    this.plan = { form: plannedForm, parameters: { ...parameters }, intent, cells, baseCents, timbre,
      context: { themeId: idea.familyId, occurrence, harmonyOccurrence, third: idea.third, tonic, regionOffsetDegrees },
      snapshot: { phraseId: Math.floor(start / FRAME_TICKS), startTick: start, endTick: end, gesture: core.name, leadRole: 'theme',
        themeId: idea.id, themeName: idea.name, relationship: idea.uses ? treatment : 'first complete thematic statement',
        grooveId: form.grooveId, envelopes, rests: sentence.rests.map(rest => ({ ...rest, scope: 'lead', voices: [5, 6, 7] })),
        cells: cells.map(cell => ({ startTick: cell.start, endTick: cell.end, role: 'theme', label: cell.label, ideaId: idea.id })),
        ideas: [], distribution: this.config.distribution, variation: this.config.variation, themeCore,
        composition: { movementId: `movement-${form.cycle}`, movementName: form.formName ?? 'Developing form', movementIndex: form.cycle,
          themeId: core.id, themeName: idea.name, themeStartTick: form.sectionStartTick, themeEndTick: form.sectionEndTick,
          phraseId: intent.id, sourcePhraseId: `${core.id}:sentence`, phraseFunction: form.role === 'return' ? 'reprise' : intent.ordinal ? 'continuation' : 'statement',
          phraseOrdinal: intent.ordinal, phraseCount: section.phrases.length, iteration: occurrence, treatment, cadence: intent.cadence, motifs,
          ...(sentence.realization?.fingerprint ? { fingerprint: structuredClone(sentence.realization.fingerprint) } : {}),
          shortPhrases,
          cues: [{ id: `${intent.id}:opening`, tick: start, kind: 'entry', strength: .65, leadVoice: 5 },
            { id: `${intent.id}:answer`, tick: middle, kind: 'entry', strength: .6, leadVoice: 5 },
            { id: `${intent.id}:apex`, tick: sentence.highPointTick, kind: 'arrival', strength: .8, leadVoice: 5 },
            { id: `${intent.id}:cadence`, tick: ending.tick, kind: 'arrival', strength: intent.cadence === 'closed' ? 1 : .45, leadVoice: 5 }],
        } } };
  }

  notes(tick: number, duration: number, tuning: TuningId, _voices: Pitch[], _bass: Pitch, additive: boolean,
    _harmonyAt?: (onset: number) => { voices: Pitch[]; bass: Pitch }): NoteEvent[] {
    if (!this.plan) return [];
    const { snapshot, cells, baseCents, timbre } = this.plan;
    const structural = cells.flatMap(cell => cell.notes.filter(note => note.core));
    const output: NoteEvent[] = [];
    cells.forEach((cell, index) => cell.notes.forEach((note, ordinal) => {
      if (note.tick < tick || note.tick >= tick + duration) return;
      const pitch = nativePitch(baseCents + note.cents, tuning), texture = this.textureAt(note.tick);
      const endPitch = !additive && note.endCents !== undefined && this.expressionContext?.glidesEnabled
        ? nativePitch(baseCents + note.endCents, tuning) : undefined;
      const cue = snapshot.composition!.cues.find(item => item.tick === note.tick);
      const structuralIndex = note.core ? structural.indexOf(note) : -1;
      const previous = structural[structuralIndex - 1];
      const leapArrival = previous && Math.abs(note.cents - previous.cents) >= 400;
      const closing = note.coreRole === 'cadence' && snapshot.composition!.cadence === 'closed';
      const arrival = closing || leapArrival || cue?.kind === 'arrival' || cue?.kind === 'entry';
      // A structural arrival blooms early, a closed ending releases, and a
      // connected interior tone carries the larger trajectory. The same late
      // crescendo on every note obscured both intervals and phrase endings.
      const delivery = closing ? [.88, 1, .9, .68] : arrival ? [.86, 1, .96, .9] : [.97, .99, 1, .96];
      output.push({ id: `phrase:${snapshot.phraseId}:${index}:${ordinal}`, tick: note.tick, duration: note.duration,
        absolutePitch: pitch, ...(endPitch ? { endPitch, glideTicks: Math.min(note.duration, note.glideTicks ?? note.duration) }
          : tuning === '12tet' ? { midiNote: pitchToMidi(pitch) } : {}), part: 'melody', voice: 5,
        velocity: round(clamp(.78 * note.accent, 0, texture.velocityCeiling)),
        articulation: note.articulation ?? (note.core && note.duration >= 720 ? 'sustained'
          : ['reed', 'lead', 'flute', 'strings'].includes(timbre) ? 'connected' : texture.articulation),
        timbre, expression: { role: note.core ? 'anchor' : 'ornament', sourceId: note.sourceId, ...(cue ? { cueId: cue.id } : {}) },
        ...(!additive && note.duration >= 360 ? { gainEnvelope: [0, .22, .68, 1].map((position, index) => ({ tick: Math.round(note.duration * position),
          gain: round((.68 + this.expressiveAt(note.tick + Math.round(note.duration * position)).intensity * .32)
            * delivery[index]) })) } : {}),
      });
    }));
    return output;
  }

  /** Preview is pure: the common orchestral realization can inform harmony
   * context without inventing or recording another foreground. */
  previewBacking(notes: NoteEvent[], tick: number, duration: number, additive: boolean, bassTemplate?: NoteEvent): NoteEvent[] {
    if (!this.plan) return notes;
    const { snapshot, form, parameters } = this.plan;
    const textureAt = (onset: number) => this.textureAt(onset);
    const accompanied = realizeAccompaniment(notes, { seed: this.seed, tick, duration, form, parameters,
      expressiveAt: onset => this.expressiveAt(onset), textureAt, additive, harmony: this.config.harmony,
      harmonySpan: { startTick: snapshot.startTick, endTick: snapshot.endTick },
      bassTemplate, tuning: form.tuning, cues: snapshot.composition!.cues, rests: snapshot.rests });
    const coordinated = coordinateEnsemble(accompanied, { seed: this.seed, tick, duration, beatTicks: 480 * 4 / form.meter.denominator,
      cues: snapshot.composition!.cues, rests: snapshot.rests, additive, config: this.composition,
      intensity: this.ensembleIntensityAt(tick), templates: notes, bassTemplate, deferDynamics: true, textureAt });
    return clipPhraseRests(coordinated, snapshot.rests, form.sectionEndTick);
  }

  shape(notes: NoteEvent[], tick: number, duration: number, additive: boolean, bassTemplate?: NoteEvent): NoteEvent[] {
    if (!this.plan) return notes;
    const clipped = this.previewBacking(notes, tick, duration, additive, bassTemplate), idea = this.plan.cells[0].idea;
    for (const note of clipped) {
      if (!note.id.startsWith(`phrase:${this.plan.snapshot.phraseId}:`) || !note.absolutePitch) continue;
      if (!this.used) { idea.uses++; this.used = true; }
      idea.lastHeardPhrase = this.plan.snapshot.phraseId; idea.lastHeardTick = note.tick;
      if (note.expression?.role === 'anchor') {
        this.heard.push(structuredClone(note));
        this.previousAnchor = { pitch: note.endPitch ?? note.absolutePitch, end: note.tick + note.duration };
      }
    }
    return clipped;
  }

  snapshot(): PhraseSnapshot | undefined {
    if (!this.plan) return undefined;
    return { ...structuredClone(this.plan.snapshot), ideas: this.archive.filter(idea => idea.uses > 0)
      .map(({ cents: _cents, positions: _positions, anchor: _anchor, third: _third, bornTick: _bornTick,
        lastHeardTick: _lastHeardTick, familyId: _familyId, answerCents: _answerCents, ...idea }) => ({ ...idea })) };
  }
  get plannedUntilTick(): number | undefined { return this.plan?.snapshot.endTick; }
  lyricalContextAt(tick: number): { startTick: number; endTick: number; themeId: string; occurrence: number; harmonyOccurrence: number;
    cadence: 'open' | 'closed'; third: 3 | 4; tonic: number; regionOffsetDegrees: number; core?: ThemeCoreSnapshot } | undefined {
    if (!this.plan || tick < this.plan.snapshot.startTick || tick >= this.plan.snapshot.endTick) return undefined;
    return { ...this.plan.context, startTick: this.plan.snapshot.startTick, endTick: this.plan.snapshot.endTick,
      cadence: this.plan.intent.cadence, core: this.plan.snapshot.themeCore };
  }
  homeThird(form: FormState): 3 | 4 {
    return this.plan?.form.sectionIndex === form.sectionIndex ? this.plan.context.third
      : (this.archive.find(idea => idea.anchor && idea.familyId === form.themeId) ?? this.archive[0]).third;
  }
  musicalCadenceAt(tick: number): { closed: boolean; strength: number } | undefined {
    if (!this.plan || tick < this.plan.snapshot.startTick || tick >= this.plan.snapshot.endTick) return undefined;
    const closed = this.plan.intent.cadence === 'closed';
    return { closed, strength: round(clamp(1 - (this.plan.snapshot.endTick - tick) / (this.plan.form.barTicks * 1.5)) * (closed ? 1 : .35)) };
  }
  ensembleIntensityAt(tick: number): number { return this.plan ? this.expressiveAt(tick).intensity : .5; }
  harmonicTargets(tick: number, duration = 960): number[] {
    if (!this.plan || tick < this.plan.snapshot.startTick || tick >= this.plan.snapshot.endTick) return [];
    const notes = this.plan.snapshot.themeCore!.notes.filter(note => note.startTick < tick + duration && note.endTick > tick);
    notes.sort((a, b) => {
      const importance = (note: typeof a) => (Math.min(note.endTick, tick + duration) - Math.max(note.startTick, tick))
        * (['head', 'apex', 'cadence'].includes(note.role) ? 1.4 : 1);
      return importance(b) - importance(a) || a.absolutePitchCents - b.absolutePitchCents;
    });
    return [...new Set(notes.map(note => note.absolutePitchCents))].slice(0, 3);
  }
  motifs(tuning: TuningId): Motif[] {
    return this.archive.filter(idea => idea.uses > 0).map(idea => {
      const native = idea.cents.map(cents => Math.round(cents * TUNINGS[tuning].divisions / 1200));
      return { id: idea.id, name: idea.name, intervals: native.map((value, index) => index ? value - native[index - 1] : 0),
        intervalUnit: `${tuning}-degrees`,
        rhythm: idea.positions.map((position, index) => Math.round(((idea.positions[index + 1] ?? position + .25) - position) * 1920)),
        born: Math.floor(idea.bornTick / 960), lastRecalled: Math.floor(idea.lastHeardTick / 960), salience: idea.anchor ? 1 : Math.min(.95, .5 + idea.uses * .06),
        level: idea.anchor || idea.uses > 2 ? 'theme' : 'phrase', recalls: Math.max(0, idea.uses - 1) };
    });
  }
}
