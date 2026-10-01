import type { FormState } from '../conductor';
import type { CompositionConfig } from '../composition';
import type { PhraseRest } from '../phrasing';
import { PPQ, type Parameters } from '../types';
import { random } from './random';
import { composeThemeCore, themeThird } from './theme-core';
import { metricStrength, subdivideBetweenTargets, type TargetSubdivision, type SubdividedAttack } from './idea-kernel';
import type { TextureAt, TextureIntent } from './texture';

export interface RhythmAttack { tick: number; strength: number; role: 'anchor' | 'answer' | 'fill'; layer?: 'reference' | 'riff' | 'response' | 'fill';
  level?: 'goal' | 'pulse' | 'subdivision'; group?: number; }
export interface RhythmCellNote { offsetTicks: number; durationTicks: number; strength: number; role: RhythmAttack['role']; }
export interface RhythmLayer {
  id: string; role: 'reference' | 'riff' | 'response'; sourceId: string;
  originTick: number; cycleTicks: number; introducedAt: number; retiresAt: number; active: boolean;
}
export interface RhythmicMoment {
  sourceId: string; themeId: string; phraseId: string;
  startTick: number; endTick: number;
  cycleStartTick: number; cycleTicks: number; iteration: number;
  feel: 'half' | 'full' | 'double';
  treatment: 'statement' | 'answer' | 'develop' | 'fill' | 'release';
  reference: { originTick: number; beatTicks: number; backbeatTicks: number; epochStartTick: number; epochEndTick: number };
  layers: RhythmLayer[];
  /** Descriptions of generated groups/attacks, never pattern selectors. */
  riffShape: string;
  fillShape: string;
  /** The unfiltered subject, for melodic quotation at argument creation. */
  cell: readonly RhythmCellNote[];
  /** The admitted shared attacks in this cycle, including developed tails. */
  accents: RhythmAttack[];
  bass: RhythmAttack[]; kick: RhythmAttack[]; snare: RhythmAttack[]; hat: RhythmAttack[];
  /** Stops the backing only. A foreground breath requires an authored lead rest. */
  rests: PhraseRest[];
}
type RhythmConfiguration = Pick<CompositionConfig, 'displacement' | 'polymeter'>;
export type ScoredTextureAt = (tick: number) => TextureIntent & { rhythm: RhythmicMoment };

/** Standalone interpreters use the same source and clock as the full score.
 * Supplied moments remain authoritative, including deliberately empty ones. */
export function withRhythmicScore(seed: string, formAt: (tick: number) => FormState, parameters: Parameters,
  textureAt: TextureAt, config: RhythmConfiguration = {}): ScoredTextureAt {
  let adapter: RhythmicScore | undefined;
  return tick => {
    const texture = textureAt(tick);
    return texture.rhythm ? texture as ReturnType<ScoredTextureAt> : { ...texture,
      rhythm: (adapter ??= new RhythmicScore(seed, formAt, config)).at(tick, parameters, texture) };
  };
}

interface Subject { sourceId: string; cell: RhythmCellNote[]; cycleTicks: number; cycles: number; shape: RhythmicMoment['riffShape']; }
const clamp = (n: number) => Math.max(0, Math.min(1, n));
const unique = (notes: RhythmAttack[]) => {
  const strikes = new Map<number, RhythmAttack>();
  for (const note of notes) {
    const prior = strikes.get(note.tick);
    // A fill can accent the reference strike without deleting the observable
    // timekeeping role or scheduling a second physical hit on the same drum.
    const reference = prior?.layer === 'reference' ? prior : note.layer === 'reference' ? note : undefined;
    strikes.set(note.tick, reference ? { ...reference, strength: Math.max(prior?.strength ?? 0, note.strength) }
      : prior && prior.strength > note.strength ? prior : note);
  }
  return [...strikes.values()].sort((a, b) => a.tick - b.tick);
};

/** One rhythmic subject is voiced by several instruments. Addressed decisions
 * choose its grouping and its phrase ending; they do not roll a new groove for
 * every frame. The foreground can quote `cell` while drum limbs interpret it:
 * kick/bass speak its anchors, snare establishes feel, cymbals reveal pulse.
 * Density admits subdivisions without rewriting the source or its clock. */
export class RhythmicScore {
  private readonly subjects = new Map<string, Subject>();
  private readonly refinements = new Map<string, SubdividedAttack[]>();
  constructor(private readonly seed: string, private readonly formAt: (tick: number) => FormState,
    private readonly config: RhythmConfiguration = {}) {}

  private refine(address: string, input: TargetSubdivision): SubdividedAttack[] {
    // Rhythmic plan selection has discrete detail levels. Continuous gain and
    // articulation still use the exact onset reading outside this kernel.
    const bounded = { ...input, syncopation: Math.round((input.syncopation ?? .2) * 16) / 16 };
    const key = `${address}:${JSON.stringify(bounded)}`, prior = this.refinements.get(key);
    if (prior) return prior;
    const result = subdivideBetweenTargets(this.seed, address, bounded);
    this.refinements.set(key, result);
    if (this.refinements.size > 256) this.refinements.delete(this.refinements.keys().next().value!);
    return result;
  }

  private subject(form: FormState): Subject {
    const key = `${form.sectionStartTick}:${form.themeId}`;
    const cached = this.subjects.get(key);
    if (cached) return cached;
    const head = composeThemeCore(this.seed, form.themeId, themeThird(this.seed, form.themeId));
    const notes = head.clauses[0].notes, weight = notes.reduce((sum, note) => sum + note.rhythmUnits, 0);
    const odd = random(this.seed, 'rhythmic-score', form.sectionStartTick, 'odd')
      < (this.config.polymeter ?? 0) * (this.config.displacement ?? 0) * .55;
    // A single asymmetric riff can cross a stable metrical pulse. It replaces
    // the square riff; it never stacks two unrelated extra drum patterns.
    const cycleTicks = odd ? (random(this.seed, 'rhythmic-score', form.themeId, 'odd-length') < .5 ? 5 : 7) * PPQ / 2
      : form.barTicks;
    let consumed = 0;
    const offsets = notes.map(note => {
      const offset = Math.round(consumed / weight * cycleTicks / 60) * 60;
      consumed += note.rhythmUnits;
      return offset;
    });
    const cell = notes.map((_, index) => ({ offsetTicks: offsets[index],
      durationTicks: (offsets[index + 1] ?? cycleTicks) - offsets[index],
      strength: index === 0 ? 1 : index === notes.length - 1 ? .88 : .76,
      role: (index === 0 ? 'anchor' : 'answer') as RhythmAttack['role'] }));
    const cycles = Math.max(4, Math.round(form.barTicks * 4 / cycleTicks))
      + Math.floor(random(this.seed, 'riff-argument-length', form.themeId) * 3);
    const shape = cell.map(member => member.durationTicks / 60).join('+') + ' tick groups (×60)';
    const result = { sourceId: head.headId, cell, cycleTicks, cycles, shape };
    this.subjects.set(key, result);
    if (this.subjects.size > 128) this.subjects.delete(this.subjects.keys().next().value!);
    return result;
  }

  at(tick: number, p: Parameters, texture: TextureIntent): RhythmicMoment {
    if (!Number.isSafeInteger(tick) || tick < 0) throw new RangeError('A rhythmic score requires a non-negative integer tick.');
    const form = this.formAt(tick), subject = this.subject(form);
    const absoluteCycle = Math.floor((tick - form.sectionStartTick) / subject.cycleTicks);
    const phrase = Math.floor(absoluteCycle / subject.cycles), iteration = absoluteCycle % subject.cycles;
    const startTick = form.sectionStartTick + phrase * subject.cycles * subject.cycleTicks;
    const endTick = Math.min(form.sectionEndTick, startTick + subject.cycles * subject.cycleTicks);
    const cycleStartTick = form.sectionStartTick + absoluteCycle * subject.cycleTicks;
    const cycleEnd = Math.min(endTick, cycleStartTick + subject.cycleTicks);
    const phraseId = `riff:${form.sectionStartTick}:${phrase}:${form.themeId}`;
    const pace = clamp(texture.pace), density = clamp(p.rhythmicDensity);
    const final = cycleEnd === endTick;
    const canDevelop = random(this.seed, 'rhythmic-score-development', phraseId) < 1 - p.rhythmicPredictability;
    const canAnswer = random(this.seed, 'rhythmic-tail-answer', phraseId, iteration) < 1 - p.rhythmicPredictability;
    const treatment: RhythmicMoment['treatment'] = final ? pace > .5 && canDevelop ? 'fill' : 'release'
      : iteration < 2 || !canDevelop || pace < .5 ? 'statement' : iteration % 2 ? 'answer' : 'develop';
    // The backbeat changes interpretation, not transport tempo. Section intent
    // sets a stable preference; a strong density edit can still request a new
    // feel immediately without moving any riff origin.
    const referenceBar = PPQ * 4;
    const epochBars = [8, 12, 16][Math.floor(random(this.seed, 'reference-epoch-length') * 3)];
    const epochTicks = epochBars * referenceBar, epoch = Math.floor(tick / epochTicks), epochStart = epoch * epochTicks, epochEnd = epochStart + epochTicks;
    const riffIn = epochStart + (1 + Math.floor(random(this.seed, 'riff-introduction', epoch) * 3)) * referenceBar;
    const responseIn = riffIn + (2 + Math.floor(random(this.seed, 'response-introduction', epoch) * 2)) * referenceBar;
    const riffOut = epochEnd - referenceBar, responseOut = epochEnd - referenceBar * 2;
    const riffActive = tick >= riffIn && tick < riffOut && pace > .35;
    const responseActive = tick >= responseIn && tick < responseOut && pace > .55 && p.rhythmicComplexity > .3;
    // The pulse uses an absolute quarter-note clock. Its longer epoch does
    // not restart when a theme, harmonic frame or odd-meter riff changes.
    const referenceForm = this.formAt(epochStart);
    const feelDrive = referenceForm.behavior?.activity ?? pace;
    const feel: RhythmicMoment['feel'] = feelDrive < .32 ? 'half' : feelDrive > .76 ? 'double' : 'full';
    let fillShape = 'No destination subdivision';
    const layers: RhythmLayer[] = [
      { id: 'reference-pulse', role: 'reference', sourceId: 'reference:quarter', originTick: 0, cycleTicks: referenceBar,
        introducedAt: 0, retiresAt: Number.MAX_SAFE_INTEGER, active: density > .09 },
      { id: `${subject.sourceId}:riff`, role: 'riff', sourceId: subject.sourceId, originTick: form.sectionStartTick,
        cycleTicks: subject.cycleTicks, introducedAt: riffIn, retiresAt: riffOut, active: riffActive && density > .03 },
      { id: `${subject.sourceId}:response`, role: 'response', sourceId: subject.sourceId, originTick: epochStart,
        cycleTicks: subject.cycleTicks * 2, introducedAt: responseIn, retiresAt: responseOut, active: responseActive && density > .17 },
    ];
    const breath = final ? Math.min(PPQ / 2, Math.max(120, Math.round(subject.cycleTicks / 12 / 120) * 120)) : 0;
    // Publish the future phrase break from the first cycle so already committed
    // sustained backing notes can be clipped before they cross it.
    const phraseBreath = Math.min(PPQ / 2, Math.max(120, Math.round(subject.cycleTicks / 12 / 120) * 120));
    const rests: PhraseRest[] = [{ startTick: Math.max(startTick, endTick - phraseBreath), endTick,
      scope: 'accompaniment', reason: 'The shared riff breathes before its next statement.' }];
    const silent = (at: number) => rests.some(rest => at >= rest.startTick && at < rest.endTick);
    const accents: RhythmAttack[] = [];
    for (const [index, member] of subject.cell.entries()) {
      const at = cycleStartTick + member.offsetTicks;
      if (at >= cycleEnd || silent(at)) continue;
      if (index > 0 && pace < .28) continue;
      if (index > 1 && pace < .42 && member.strength < .85) continue;
      accents.push({ tick: at, strength: member.strength, role: member.role, layer: 'riff', level: 'goal', group: index });
    }
    // Predictability also has an ordinary-density realization. Previously its
    // only audible effects required a fast, dense, late response layer, making
    // this macro inert for many complete performances. A single tail answer
    // develops an established cell; it never displaces the reference pulse or
    // rewrites the identifying head. One addressed answer decision belongs to
    // each whole repetition, independent of scheduling calls and subdivisions.
    const groupAt = (at: number) => {
      let group = 0;
      for (let index = 1; index < subject.cell.length; index++) if (cycleStartTick + subject.cell[index].offsetTicks <= at) group = index;
      return group;
    };
    if (riffActive && density > .09 && iteration >= 1 && !final && canAnswer) {
      const original = [...accents];
      const extra = Math.min(8, Math.ceil((.3 + pace * density * (1 + p.rhythmicComplexity * 3)) * (1 - p.rhythmicPredictability)));
      const landmarks = new Map(original.map(note => [note.tick, { tick: note.tick, strength: note.strength }]));
      // Subdivide around the already audible quarter reference too. Otherwise
      // the one permitted low-density answer can land on an existing drum
      // strike, making a whole range of predictability edits inaudible.
      for (let at = Math.ceil(cycleStartTick / PPQ) * PPQ; at < cycleEnd; at += PPQ)
        if (!landmarks.has(at)) landmarks.set(at, { tick: at, strength: .72 });
      const refined = this.refine(`${phraseId}:delivery:${iteration % 3}`, { startTick: cycleStartTick, endTick: cycleEnd,
        gridTicks: pace > .83 ? 60 : 120, attackBudget: landmarks.size + extra, anchors: [...landmarks.values()],
        pulseTicks: PPQ, originTick: 0, syncopation: texture.syncopation });
      for (const member of refined) if (!landmarks.has(member.tick) && !silent(member.tick))
        accents.push({ tick: member.tick, strength: Math.min(.68, member.strength * .78), role: 'answer',
          layer: responseActive ? 'response' : 'riff', level: member.level, group: groupAt(member.tick) });
    }
    if (treatment === 'fill') {
      const count = Math.max(1, Math.ceil(subject.cell.length * pace * p.rhythmicComplexity * .6));
      const fillStart = cycleStartTick + subject.cell[Math.max(0, subject.cell.length - count)].offsetTicks;
      const fillEnd = cycleEnd - breath;
      if (fillEnd > fillStart) {
        const budget = Math.min(14, Math.max(2, Math.ceil((fillEnd - fillStart) / PPQ * (1 + pace * density * (3 + p.rhythmicComplexity * 4)))));
        const refined = this.refine(`${phraseId}:destination`, { startTick: fillStart, endTick: fillEnd,
          gridTicks: pace > .83 && p.rhythmicComplexity > .6 ? 60 : 120, attackBudget: budget,
          anchors: accents.filter(note => note.tick >= fillStart), pulseTicks: PPQ, originTick: 0, direction: 1,
          syncopation: texture.syncopation });
        for (const member of refined) if (!silent(member.tick)) accents.push({ tick: member.tick,
          strength: Math.min(.95, member.strength * (.65 + .35 * (member.tick - fillStart) / (fillEnd - fillStart))),
          role: 'fill', layer: 'fill', level: member.level, group: groupAt(member.tick) });
        fillShape = `${refined.length} attacks across ${count} source groups`;
      }
    }
    const admitted = unique(accents);
    const bass = admitted.filter(note => note.role !== 'fill' || note.level !== 'subdivision' || note.strength > .58);
    const kick = density <= .03 ? [] : admitted.filter(note => note.role === 'fill'
      ? note.level === 'goal' || note.strength > .7
      : riffActive || note.role === 'anchor')
      .map(note => ({ ...note, strength: note.strength * (note.role === 'fill' ? .8 : 1) }));
    const snare: RhythmAttack[] = [], hat: RhythmAttack[] = [];
    const beatTicks = PPQ;
    const backbeatGrid = feel === 'half' ? beatTicks * 4 : feel === 'double' ? beatTicks : beatTicks * 2;
    const backbeatOffset = feel === 'half' ? beatTicks * 2 : feel === 'double' ? beatTicks / 2 : beatTicks;
    if (density > .09) {
      for (let at = Math.ceil(cycleStartTick / 120) * 120; at < cycleEnd; at += 120) {
        if (silent(at)) continue;
        const relative = at;
        if (density > .17 && relative >= backbeatOffset && (relative - backbeatOffset) % backbeatGrid === 0)
          snare.push({ tick: at, strength: feel === 'half' ? 1 : .93, role: 'anchor', layer: 'reference', level: 'pulse' });
        if (relative % beatTicks === 0) {
          const metric = metricStrength(at, { originTick: form.barStartTick, beatTicks: PPQ * 4 / form.meter.denominator,
            barTicks: form.barTicks, groups: form.meterGroups });
          hat.push({ tick: at, strength: .66 + metric * .2, role: 'anchor', layer: 'reference', level: 'pulse' });
          if (relative % (PPQ * 2) === 0) kick.push({ tick: at, strength: .78 + metric * .1, role: 'anchor', layer: 'reference', level: 'pulse' });
        }
        else if (riffActive && density > .4 && relative % (responseActive && pace > .8 ? 120 : 240) === 0)
          hat.push({ tick: at, strength: .27, role: 'answer', layer: 'riff' });
        const metric = metricStrength(at, { originTick: form.barStartTick, beatTicks: PPQ * 4 / form.meter.denominator,
          barTicks: form.barTicks, groups: form.meterGroups });
        if (metric >= .9 && relative % (PPQ * 2) !== 0)
          kick.push({ tick: at, strength: .86, role: 'anchor', layer: 'reference', level: 'goal' });
      }
      // The same low-density tail answer is heard on cymbal as well as bass
      // and kick. It stays subordinate to the unchanged quarter-note strikes.
      if (riffActive && iteration >= 2 && !final && canAnswer) {
        const tailStart = cycleStartTick + subject.cell.at(-1)!.offsetTicks;
        for (const note of admitted) if (note.role === 'answer' && note.tick > tailStart && note.layer === 'riff')
          hat.push({ ...note, strength: note.strength * .65 });
      }
    }
    for (const note of admitted.filter(note => note.role === 'fill')) if (density > .17) {
      const parent = cycleStartTick + subject.cell[note.group ?? 0].offsetTicks;
      if (note.level !== 'subdivision' || Math.floor((note.tick - parent) / 120) % 2 === 0) snare.push(note);
      else hat.push({ ...note, strength: note.strength * .78 });
    }
    // Ghost responses are derivatives of the riff ending, not an independent
    // probability grid. The first two statements are deliberately unadorned.
    if (responseActive && density > .45 && iteration > 1 && canDevelop) {
      const last = admitted.filter(note => note.role !== 'fill').at(-1);
      if (last && !snare.some(note => note.tick === last.tick) && !silent(last.tick)) snare.push({ ...last, strength: .32, role: 'answer', layer: 'response' });
    }
    return { sourceId: subject.sourceId, themeId: form.themeId, phraseId, startTick, endTick,
      cycleStartTick, cycleTicks: subject.cycleTicks, iteration, feel, treatment, cell: subject.cell,
      reference: { originTick: 0, beatTicks, backbeatTicks: backbeatGrid, epochStartTick: epochStart, epochEndTick: epochEnd },
      layers, riffShape: subject.shape, fillShape,
      accents: admitted, bass, kick: unique(kick), snare: unique(snare), hat: unique(hat), rests };
  }
}
