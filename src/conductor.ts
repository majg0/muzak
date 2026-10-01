import { random } from './engine/random';
import { thematicCell } from './engine/idea-kernel';
import { expressiveContourAt } from './engine/expression';
import { openingGesture, planSectionBehaviors, type SectionBehavior } from './form-score';
import { PARAMETER_DEFINITIONS, normalizeParameters } from './parameters';
import type { TuningId } from './pitch';
import { FRAME_TICKS, PPQ, type ParameterKey, type Parameters } from './types';

export interface ConductorConfig { enabled: boolean; amount: number; pace: number; tuningTravel: boolean; }
export const DEFAULT_CONDUCTOR: ConductorConfig = { enabled: true, amount: .85, pace: .6, tuningTravel: true };
export const MANUAL_CONDUCTOR: ConductorConfig = { enabled: false, amount: 0, pace: .6, tuningTravel: false };
export type InstrumentColor = 'keys' | 'glass' | 'reed' | 'pluck' | 'round' | 'strings' | 'flute' | 'brass' | 'lead';
export type FormRole = 'intro' | 'theme' | 'answer' | 'development' | 'climax' | 'breakdown' | 'return';
export interface FormState {
  sectionIndex: number; cycle: number; sectionName: string; role: FormRole;
  sectionStartTick: number; sectionEndTick: number; progress: number;
  phraseIndex: number; phraseStartTick: number; phraseEndTick: number; phrasePosition: number;
  bar: number; beat: number; meter: { numerator: number; denominator: 4 | 8 };
  barStartTick: number; barTicks: number; subdivisionTicks: number; swing: number;
  grooveId: string; themeId: string; instrument: InstrumentColor; tuning: TuningId; gliding: boolean;
  formName?: string; sectionIntent?: string; tonalOffsetCents?: number;
  meterSourceId?: string; meterGroups?: number[]; meterResidenceStartTick?: number; meterReason?: string;
  behavior?: SectionBehavior;
}

type Meter = FormState['meter'];
type Family = number;
interface Episode {
  role: FormRole; family: Family; intent: string; name: string; region: number;
  statement?: boolean;
  introduction?: boolean;
  extension?: boolean;
}
interface SectionLayout extends Episode {
  startTick: number; endTick: number; firstBar: number; bars: number; barTicks: number; meter: Meter;
  firstPhrase: number;
  meterFamily: Family; residenceFirstSection: number;
  cycle: number; ordinal: number; formName: string; excursion: boolean; tuningChoice: number; behavior: SectionBehavior;
}
interface Layout { sections: SectionLayout[]; ticks: number; bars: number; phrases: number; palette: InstrumentColor[]; grooves: number[]; }
const ROLES: FormRole[] = ['intro', 'theme', 'answer', 'development', 'climax', 'breakdown', 'return'];
const themeInventoryCache = new Map<string, readonly string[]>();
/** A piece has a bounded repertoire, addressed once by its identity. Consumers
 * share these source IDs without assuming a particular number of themes. */
export function themeIds(seed: string): readonly string[] {
  let themes = themeInventoryCache.get(seed);
  if (!themes) {
    const count = 3 + Math.floor(random(seed, 'form-theme-repertoire') * 5);
    themes = Object.freeze(Array.from({ length: count }, (_, family) => `theme-${String.fromCharCode(97 + family)}`));
    if (themeInventoryCache.size >= 128) themeInventoryCache.delete(themeInventoryCache.keys().next().value!);
    themeInventoryCache.set(seed, themes);
  }
  return themes;
}
// Fixed aggregate geometry is an indexing budget, never a route or cadence.
// Every block independently composes its episode order and duration assignment.
// This permits distant seeking without replaying an unbounded musical history.
const LAYOUT_CYCLES = 16;
const LAYOUT_SECTIONS = 128;
const layoutCache = new Map<string, Layout>();
const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const unit = (value: number, fallback: number) => Number.isFinite(value) ? clamp(value) : fallback;
const smooth = (value: number) => value * value * (3 - 2 * value);

function seededOrder<T extends string | number>(seed: string, domain: string, values: readonly T[], ...address: number[]): T[] {
  return values.map((value, index) => ({ value, index, rank: random(seed, domain, ...address, value) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index).map(item => item.value);
}

function assertPosition(value: number, name: string) {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${name} must be a non-negative integer.`);
}

interface IdeaLife { heard: boolean; last: number; uses: number; departures: number; paidDepartures: number; }
type JourneyAim = 'continue' | 'exchange' | 'explore' | 'remember' | 'release';
const label = (family: Family) => `Theme ${String.fromCharCode(65 + family)}`;

/** Choice depends on what has been heard and what remains unresolved. A
 * journey may extend its current thought, meet another idea, or hand off an
 * open departure. No role is mandatory at the next bookkeeping boundary. */
function nextEpisode(seed: string, block: number, index: number, cycle: number, aim: JourneyAim,
  life: IdeaLife[], previous: Episode | undefined, freedom: number): Episode {
  const address = [block, index, cycle] as const;
  const families = life.map((_, family) => family);
  const heard = families.filter(family => life[family].heard);
  const waiting = seededOrder(seed, 'form-new-family-order', families.slice(1)).filter(family => !life[family].heard);
  const current = previous?.family ?? Math.floor(random(seed, 'form-block-context', block) * life.length);
  const region = [500, 700, -300, 200, 900][Math.floor(random(seed, 'form-episode-region', ...address) * 5)];
  const introduce = (family: Family): Episode => ({ role: 'theme', family, name: `${label(family)} · first statement`,
    intent: `Give ${label(family).toLowerCase()} its complete first statement before drawing on its memory.`, region: family === 0 ? 0 : region, statement: true, introduction: true });
  if (!heard.length) {
    const pickup = index === 0 && (freedom < .7 || openingGesture(seed) === 'air') && random(seed, 'form-opening-pickup') < .45;
    return pickup ? { role: 'intro', family: 0, name: 'First light', intent: 'Hint at theme a before its complete statement.', region: 0 } : introduce(0);
  }
  // Every later block may use the original heard repertoire. First-block
  // deadlines establish that archive without prescribing their arrival bars.
  if (waiting.length && index >= (life.length - waiting.length) * 5) return introduce(waiting[0]);
  const choices: { episode: Episode; weight: number }[] = [];
  const add = (episode: Episode, weight: number) => {
    if (previous?.role === episode.role && previous.family === episode.family && previous.intent === episode.intent) return;
    choices.push({ episode, weight });
  };
  if (waiting.length) add(introduce(waiting[0]), .2 + index * .045 + (aim === 'exchange' ? .65 : 0));
  for (const family of heard) {
    const idea = life[family], age = index - idea.last, same = family === current;
    if (same) {
      const extension = previous?.role === 'theme' || previous?.role === 'answer';
      add({ role: 'theme', family, name: `${label(family)} · ${extension ? 'continued thought' : 'restated in context'}`,
        intent: extension ? `Extend the heard ${label(family).toLowerCase()} beyond its first answer, keeping the argument open.`
          : `Restate the heard ${label(family).toLowerCase()} in the context left by its previous episode.`, region: previous?.region ?? 0, statement: true, extension },
      .3 + (aim === 'continue' ? 1.15 : .15) + (idea.uses === 1 ? .45 : 0));
      add({ role: 'development', family, name: `${label(family)} · ${previous?.role === 'development' ? 'continuation farther out' : 'departure'}`,
        intent: previous?.role === 'development' ? `Carry the unfinished departure of ${label(family).toLowerCase()} farther before deciding its arrival.`
          : `Develop the heard fingerprint of ${label(family).toLowerCase()} toward another region.`, region },
      (previous?.role === 'development' ? .25 : .65) + (aim === 'explore' ? .9 : 0));
    }
    if (age <= 5 && previous?.role !== 'breakdown') add({ role: 'answer', family, name: `${label(family)} · ${same ? 'further answer' : 'interleaved reply'}`,
      intent: same ? `Let ${label(family).toLowerCase()} answer its own unfinished thought.`
        : `Bring the heard ${label(family).toLowerCase()} into conversation with ${label(current).toLowerCase()}.`, region: same ? previous?.region ?? 0 : region },
    (same ? .3 : .65) + (aim === 'exchange' ? .9 : 0));
    if (age >= 2 && (block === 0 || index >= 2)) add({ role: 'return', family, name: `${label(family)} · remembered after ${same ? 'departure' : 'another voice'}`,
      intent: `Recall the previously heard ${label(family).toLowerCase()} after its absence, carrying the intervening material into its surroundings.`, region: 0, statement: true },
    .15 + Math.min(age, 12) * .07 + (aim === 'remember' ? 1 : 0));
    if (idea.departures > idea.paidDepartures) add({ role: 'climax', family, name: `${label(family)} · earned arrival`,
      intent: `Pay off the earlier unfinished development of ${label(family).toLowerCase()}; its arrival need not end the larger journey.`, region: 700 },
    (same ? .32 : .13) + (aim === 'explore' ? .45 : 0));
    if (same || age <= 2) add({ role: 'breakdown', family, name: `${label(family)} · room to remember`,
      intent: `Let a trace of ${label(family).toLowerCase()} remain while the surrounding texture withdraws.`, region: 0 },
    (previous?.role === 'climax' ? 1.5 : previous?.role === 'development' ? .45 : .12) + (aim === 'release' ? .8 : 0));
  }
  let draw = random(seed, 'form-lifecycle-choice', ...address) * choices.reduce((sum, choice) => sum + choice.weight, 0);
  for (const choice of choices) { draw -= choice.weight; if (draw < 0) return choice.episode; }
  return choices.at(-1)!.episode;
}

/** The source's actual rhythmic span defines its metrical home. This same
 * cell supplies the melodic head and ensemble accents; there is no separate
 * catalogue that assigns a new signature to each section role. */
export function rhythmicHomeFor(seed: string, themeId: string) {
  const key = `${seed.length}:${seed}/${themeId}`;
  let home = rhythmicHomeCache.get(key);
  if (!home) {
    const cell = thematicCell(seed, themeId);
    const denominator: 4 | 8 = cell.units % 4 === 0 ? 4 : 8;
    const unitsPerBeat = denominator === 4 ? 4 : 2;
    home = { cell, meter: { numerator: cell.units / unitsPerBeat, denominator }, groups: cell.groups.map(group => group / unitsPerBeat) };
    if (rhythmicHomeCache.size >= 256) rhythmicHomeCache.delete(rhythmicHomeCache.keys().next().value!);
    rhythmicHomeCache.set(key, home);
  }
  return { ...home, meter: { ...home.meter }, groups: [...home.groups],
    cell: { ...home.cell, groups: [...home.cell.groups], attacks: home.cell.attacks.map(attack => ({ ...attack })) } };
}
const rhythmicHomeCache = new Map<string, { cell: ReturnType<typeof thematicCell>; meter: Meter; groups: number[] }>();

interface Geometry { id: number; family: Family; meter: Meter; bars: number; barTicks: number; }
function geometryInventory(seed: string, pace: number): Geometry[] {
  const homes = themeIds(seed).map(themeId => rhythmicHomeFor(seed, themeId));
  const gcd = (a: number, b: number): number => b ? gcd(b, a % b) : a;
  return Array.from({ length: LAYOUT_SECTIONS }, (_, id) => {
    const family = Math.floor(id * homes.length / LAYOUT_SECTIONS);
    const meter = homes[family].meter;
    const choices = pace < .2 ? [8, 10, 12, 14, 16, 18, 20, 24, 32]
      : pace < .4 ? [6, 8, 10, 12, 14, 16, 18, 20, 24]
        : pace < .75 ? [4, 6, 7, 8, 9, 10, 12, 14, 16] : [4, 5, 6, 7, 8, 9, 10, 12];
    const reserveStatement = id === 1 || id > 0 && Math.floor((id - 1) * homes.length / LAYOUT_SECTIONS) !== family;
    const requested = id === 0 ? 4 : Math.max(reserveStatement ? 8 : 0,
      choices[Math.floor(random(seed, 'form-geometry-length', id) * choices.length)]);
    const barTicks = meter.numerator * PPQ * 4 / meter.denominator;
    const quantum = FRAME_TICKS / gcd(FRAME_TICKS, barTicks);
    // A complete argument needs physical musical room as well as true bars.
    // A short source cycle must not compress its preparation to a few beats.
    const minimumBars = Math.ceil(12 * PPQ / barTicks);
    return { id, family, meter, bars: Math.ceil(Math.max(requested, minimumBars) / quantum) * quantum, barTicks };
  });
}

function journeyName(episodes: Episode[]): string {
  const families = [...new Set(episodes.map(episode => episode.family))];
  const returned = episodes.find(episode => episode.role === 'return');
  if (returned && families.length > 1) return `${label(returned.family)} remembered among other voices`;
  if (episodes.some(episode => episode.role === 'climax')) return `An arrival for ${label(episodes.find(episode => episode.role === 'climax')!.family).toLowerCase()}`;
  if (families.length > 2) return 'A widening conversation';
  if (families.length === 2) return `${label(families[0])} and ${label(families[1]).toLowerCase()} in conversation`;
  return `${label(families[0])} ${episodes.some(episode => episode.role === 'development') ? 'carried farther' : 'in an extended thought'}`;
}

function layoutFor(seed: string, config: ConductorConfig, repetition = 0): Layout {
  const pace = unit(config.pace, DEFAULT_CONDUCTOR.pace), freedom = unit(config.amount, DEFAULT_CONDUCTOR.amount);
  const key = `${seed.length}:${seed}/${pace}/${freedom}/${repetition}`;
  const cached = layoutCache.get(key);
  if (cached) return cached;
  const remaining = geometryInventory(seed, pace), sections: SectionLayout[] = [];
  // Later blocks inherit the originally exposed repertoire, not imaginary
  // local expositions. Only real development in this block earns a new climax.
  const life: IdeaLife[] = themeIds(seed).map((_, family) => ({ heard: repetition > 0,
    last: -4 - family, uses: repetition > 0 ? 2 : 0, departures: 0, paidDepartures: 0 }));
  let ticks = 0, bars = 0, phrases = 0, previous: Episode | undefined;
  let meterFamily: Family | undefined, residenceRemaining = 0, residenceFirstSection = 0;
  for (let cycle = 0; cycle < LAYOUT_CYCLES; cycle++) {
    const absoluteCycle = repetition * LAYOUT_CYCLES + cycle;
    const remainingCycles = LAYOUT_CYCLES - cycle - 1, available = LAYOUT_SECTIONS - sections.length;
    const minimum = Math.max(5, available - remainingCycles * 12), maximum = Math.min(12, available - remainingCycles * 5);
    const count = minimum + Math.floor(random(seed, 'form-journey-span', absoluteCycle) * (maximum - minimum + 1));
    const aim = (['continue', 'exchange', 'explore', 'remember', 'release'] as const)[Math.floor(random(seed, 'form-journey-aim', absoluteCycle) * 5)];
    const episodes: { episode: Episode; geometry: Geometry; residenceFirstSection: number }[] = [];
    for (let ordinal = 0; ordinal < count; ordinal++) {
      const index = sections.length + ordinal;
      let episode = nextEpisode(seed, repetition, index, absoluteCycle, aim, life, previous, freedom);
      if (repetition > 0 && index === 0) episode = { ...episode,
        name: `${label(episode.family)} · carried into a new context`,
        intent: `Carry the archived ${label(episode.family).toLowerCase()} into another context without requiring a fresh exposition or a final cadence.` };
      if (!residenceRemaining) {
        // A metrical residence belongs to a real source argument. The finite
        // source-owned geometry pool gives every cache block identical totals,
        // while its order follows the evolving conversation. Several complete
        // sections inhabit that pulse before another source can lead it.
        const availableFamilies = life.map((_, family) => family).filter(family => remaining.some(item => item.family === family));
        const nextFamily = availableFamilies.includes(episode.family) ? episode.family
          : availableFamilies.slice().sort((a, b) => life[a].last - life[b].last || a - b)[0];
        if (nextFamily !== episode.family) {
          episode = life[nextFamily].heard
            ? { role: 'theme', family: nextFamily, name: `${label(nextFamily)} · rhythm takes the foreground`,
              intent: `Let the heard rhythmic grouping of ${label(nextFamily).toLowerCase()} lead a complete renewed argument.`, region: 0, statement: true }
            : { role: 'theme', family: nextFamily, name: `${label(nextFamily)} · first statement`,
              intent: `Introduce ${label(nextFamily).toLowerCase()} with its own rhythmic grouping and a complete first statement.`, region: 0, statement: true, introduction: true };
        }
        if (meterFamily !== nextFamily) residenceFirstSection = index;
        meterFamily = nextFamily;
        const availableCount = remaining.filter(item => item.family === meterFamily).length;
        const spans = [4, 5, 6, 7].filter(span => span === availableCount || availableCount - span >= 4);
        residenceRemaining = spans.length ? spans[Math.floor(random(seed, 'form-meter-residence', repetition, index, meterFamily) * spans.length)] : availableCount;
      }
      let wanted = episode.role === 'intro' ? 4 : episode.statement ? 8 + (1 - pace) * 8 : 4 + (1 - pace) * 7;
      if (episode.extension) wanted += 3 + random(seed, 'form-argument-extension', repetition, index) * (pace < .4 ? 14 : 5);
      if (episode.role === 'return' && pace < .4) wanted += Math.min(12, (index - life[episode.family].last) * .75);
      const residenceGeometry = remaining.filter(item => item.family === meterFamily);
      let eligible = residenceGeometry.filter(item => !episode.introduction || item.bars >= 8);
      if (!eligible.length && episode.introduction) {
        // An unheard argument needs a complete first statement. If this
        // residence has spent its long spans, continue a heard source until
        // another suitable span is available. Never dereference empty geometry
        // or claim a compressed hint was a complete introduction.
        const family = meterFamily!;
        const continuation = `Continue the heard ${label(family).toLowerCase()} while its established rhythmic residence unfolds.`;
        episode = { role: 'theme', family, name: `${label(family)} · continued residence`, region: previous?.region ?? 0,
          statement: true, extension: true,
          intent: previous?.intent === continuation
            ? `Restate ${label(family).toLowerCase()} within its inhabited pulse before inviting another source.` : continuation };
        eligible = residenceGeometry;
      }
      if (!eligible.length) throw new Error('A metrical residence exhausted its reserved geometry.');
      let geometry = eligible[0], best = Infinity;
      for (const item of eligible) {
        const score = Math.abs(item.bars - wanted) / Math.max(4, wanted) * 2
          + random(seed, 'form-duration-placement', repetition, index, item.id) * .45;
        if (score < best) { best = score; geometry = item; }
      }
      // A long remaining span continues a source instead of stretching a short
      // fill or a silence into an accidental half-minute episode.
      if (geometry.bars > 20 && !episode.statement) episode = { role: 'theme', family: episode.family,
        name: `${label(episode.family)} · expanded continuation`, intent: `Let the established ${label(episode.family).toLowerCase()} unfold through several connected clauses.`,
        region: episode.region, statement: true, extension: true };
      remaining.splice(remaining.findIndex(item => item.id === geometry.id), 1);
      episodes.push({ episode, geometry, residenceFirstSection });
      residenceRemaining--;
      const memory = life[episode.family];
      if (episode.role !== 'intro') { memory.heard = true; memory.uses++; memory.last = index; }
      if (episode.role === 'development') memory.departures++;
      if (episode.role === 'climax' || episode.role === 'return' || episode.role === 'breakdown') memory.paidDepartures = memory.departures;
      previous = episode;
    }
    const behaviors = planSectionBehaviors(seed, absoluteCycle, episodes.map(item => item.episode.role), freedom);
    const formName = journeyName(episodes.map(item => item.episode));
    const tourLength = Math.min(count - 2, 3 + Math.floor(random(seed, 'form-tuning-residence', absoluteCycle) * 2));
    const latestStart = count - 1 - tourLength;
    const tourStart = 1 + Math.floor(random(seed, 'form-tuning-departure', absoluteCycle) * latestStart), tourEnd = tourStart + tourLength;
    const tuningChoice = random(seed, 'form-tuning-destination', absoluteCycle);
    for (const [ordinal, { episode, geometry, residenceFirstSection }] of episodes.entries()) {
      const endTick = ticks + geometry.bars * geometry.barTicks, behavior = { ...behaviors[ordinal] };
      if (ordinal === tourStart || ordinal === tourEnd) behavior.entry = 'flow';
      sections.push({ ...episode, startTick: ticks, endTick, firstBar: bars, firstPhrase: phrases,
        bars: geometry.bars, barTicks: geometry.barTicks, meter: geometry.meter, cycle, ordinal, formName,
        meterFamily: geometry.family, residenceFirstSection,
        excursion: ordinal >= tourStart && ordinal < tourEnd, tuningChoice, behavior });
      ticks = endTick; bars += geometry.bars; phrases += Math.ceil(geometry.bars / 4);
    }
  }
  const result: Layout = { sections, ticks, bars, phrases,
    palette: seededOrder<InstrumentColor>(seed, 'form-instrument-palette', freedom >= .7
      ? ['keys', 'glass', 'reed', 'pluck', 'round', 'strings', 'flute', 'brass', 'lead'] : ['keys', 'glass', 'reed', 'pluck', 'round']),
    grooves: seededOrder(seed, 'form-groove-palette', [0, 1, 2]) };
  if (layoutCache.size >= 32) layoutCache.delete(layoutCache.keys().next().value!);
  layoutCache.set(key, result);
  return result;
}

function tuningAt(section: SectionLayout | undefined, config: ConductorConfig, home: TuningId): TuningId {
  if (!config.enabled || !config.tuningTravel || !section?.excursion) return home;
  const destinations: Array<[TuningId, number]> = [['12tet', .08], ['19edo', .7], ['24edo', .13], ['31edo', .09]];
  const choices = destinations.filter(([tuning]) => tuning !== home);
  let draw = section.tuningChoice * choices.reduce((sum, [, weight]) => sum + weight, 0);
  for (const [tuning, weight] of choices) { draw -= weight; if (draw < 0) return tuning; }
  return choices.at(-1)![0];
}

function findSection(layout: Layout, position: number, bars = false): number {
  let low = 0, high = layout.sections.length - 1;
  while (low < high) {
    const middle = (low + high) >>> 1, section = layout.sections[middle];
    if (position < (bars ? section.firstBar + section.bars : section.endTick)) high = middle;
    else low = middle + 1;
  }
  return low;
}

function manualForm(tick: number, home: TuningId): FormState {
  const barTicks = PPQ * 4, bar = Math.floor(tick / barTicks), sectionIndex = Math.floor(bar / 8), phraseIndex = Math.floor(bar / 4);
  const sectionStartTick = sectionIndex * 8 * barTicks, phraseStartTick = phraseIndex * 4 * barTicks;
  return {
    sectionIndex, cycle: Math.floor(sectionIndex / 8), sectionName: 'Manual performance', role: 'theme',
    sectionStartTick, sectionEndTick: sectionStartTick + 8 * barTicks, progress: (tick - sectionStartTick) / (8 * barTicks),
    phraseIndex, phraseStartTick, phraseEndTick: phraseStartTick + 4 * barTicks, phrasePosition: (tick - phraseStartTick) / (4 * barTicks),
    bar, beat: 1 + (tick % barTicks) / PPQ, meter: { numerator: 4, denominator: 4 },
    barStartTick: bar * barTicks, barTicks, subdivisionTicks: PPQ / 2, swing: 0,
    grooveId: 'manual', themeId: 'manual', instrument: 'keys', tuning: home, gliding: false,
    meterSourceId: 'manual-pulse', meterGroups: [2, 2], meterResidenceStartTick: 0,
    meterReason: 'The manual performance retains its declared four-quarter pulse.',
  };
}

export function formAt(seed: string, tick: number, config: ConductorConfig, homeTuning: TuningId = '12tet'): FormState {
  assertPosition(tick, 'Musical tick');
  if (!config.enabled) return manualForm(tick, homeTuning);
  const atlas = layoutFor(seed, config), repetition = Math.floor(tick / atlas.ticks), localTick = tick % atlas.ticks;
  const layout = repetition === 0 ? atlas : layoutFor(seed, config, repetition);
  const localSectionIndex = findSection(layout, localTick);
  const section = layout.sections[localSectionIndex];
  const sectionIndex = repetition * layout.sections.length + localSectionIndex, cycle = repetition * LAYOUT_CYCLES + section.cycle;
  const sectionStartTick = repetition * layout.ticks + section.startTick, sectionEndTick = repetition * layout.ticks + section.endTick;
  const withinSection = tick - sectionStartTick, localBar = Math.floor(withinSection / section.barTicks);
  const firstBar = repetition * layout.bars + section.firstBar, bar = firstBar + localBar, barStartTick = sectionStartTick + localBar * section.barTicks;
  const phraseInSection = Math.floor(localBar / 4), phraseStartTick = sectionStartTick + phraseInSection * section.barTicks * 4;
  const phraseEndTick = Math.min(sectionEndTick, phraseStartTick + section.barTicks * 4), role = section.role;
  const homeGroove = (section.family + cycle) % 3;
  const grooveIndex = layout.grooves[(homeGroove + (role === 'breakdown' ? 1 : role === 'development' ? 2 : 0)) % 3];
  const themes = themeIds(seed), themeId = themes[section.family];
  // Each seed has a recurring palette. The home/return keep their theme color;
  // other roles rotate through it, rather than every seed assigning the same
  // instrument to development, climax, and breakdown forever.
  const instrument = layout.palette[['intro', 'theme', 'answer', 'return'].includes(role) ? section.family % layout.palette.length
    : (section.family + cycle + (role === 'development' ? 2 : role === 'climax' ? 3 : 4)) % layout.palette.length];
  const freedom = unit(config.amount, DEFAULT_CONDUCTOR.amount);
  const behavior = { ...section.behavior,
    destinationSection: repetition * layout.sections.length + localSectionIndex - section.ordinal + section.behavior.destinationSection! };
  const quiet = behavior ? behavior.activity < .3 : role === 'intro' || role === 'breakdown';
  const adventurous = behavior ? behavior.activity >= .7 : role === 'development' || role === 'climax';
  const grids = quiet ? [480, 480, 240]
    : adventurous && freedom > .7 ? role === 'climax' ? [120, 120, 80] : [160, 120, 80]
      : freedom > .45 ? [240, 240, 160, 120] : [240, 240, 120];
  // Home and return share the grid as well as the groove. All choices divide
  // the quarter-note pulse; the kick/backbeat identity remains independent.
  const subdivisionTicks = grids[Math.floor(random(seed, 'form-subdivision', cycle, quiet ? 'quiet' : adventurous ? role : grooveIndex) * grids.length)];
  const tuning = tuningAt(section, config, homeTuning);
  const previousSection = localSectionIndex > 0 ? layout.sections[localSectionIndex - 1] : repetition > 0 ? layoutFor(seed, config, repetition - 1).sections.at(-1) : undefined;
  const rhythmicHome = rhythmicHomeFor(seed, themes[section.meterFamily]);
  const residence = layout.sections[section.residenceFirstSection];
  return {
    sectionIndex, cycle, sectionName: section.name, role, sectionStartTick, sectionEndTick,
    progress: withinSection / (sectionEndTick - sectionStartTick),
    phraseIndex: repetition * layout.phrases + section.firstPhrase + phraseInSection, phraseStartTick, phraseEndTick,
    phrasePosition: (tick - phraseStartTick) / (phraseEndTick - phraseStartTick),
    bar, beat: 1 + (tick - barStartTick) / (PPQ * 4 / section.meter.denominator), meter: { ...section.meter },
    barStartTick, barTicks: section.barTicks,
    subdivisionTicks,
    swing: clamp([0.025, 0.17, 0.09][grooveIndex] * (.55 + random(seed, 'form-swing', grooveIndex) * .6) * (.7 + freedom * .3), 0, .2),
    grooveId: ['steady-pocket', 'lilting-pocket', 'broken-pocket'][grooveIndex], themeId, instrument, tuning,
    gliding: sectionIndex > 0 && withinSection < FRAME_TICKS && tuning !== tuningAt(previousSection, config, homeTuning),
    formName: section.formName, sectionIntent: section.intent, tonalOffsetCents: section.region,
    meterSourceId: rhythmicHome.cell.id, meterGroups: [...rhythmicHome.groups],
    meterResidenceStartTick: repetition * layout.ticks + residence.startTick,
    meterReason: `${label(section.meterFamily)}'s source grouping ${rhythmicHome.groups.join(' + ')} carries the pulse through this conversation.`,
    ...(behavior ? { behavior } : {}),
  };
}

/** True mixed-meter bar positions, independent of tempo and audio time. */
export function barToTick(seed: string, barZeroBased: number, config: ConductorConfig, _homeTuning: TuningId = '12tet'): number {
  assertPosition(barZeroBased, 'Bar index');
  if (!config.enabled) {
    const tick = barZeroBased * PPQ * 4;
    assertPosition(tick, 'Musical tick');
    return tick;
  }
  const atlas = layoutFor(seed, config), repetition = Math.floor(barZeroBased / atlas.bars), localBar = barZeroBased % atlas.bars;
  const layout = repetition === 0 ? atlas : layoutFor(seed, config, repetition);
  const section = layout.sections[findSection(layout, localBar, true)];
  const tick = repetition * layout.ticks + section.startTick + (localBar - section.firstBar) * section.barTicks;
  assertPosition(tick, 'Musical tick');
  return tick;
}

// Columns: intro, theme, answer, development, climax, breakdown, return.
// Character macros have musical trajectories; home profiles foreground
// stable intervals, clear attraction, recognizable melody, and a reliable pulse.
type Profile = readonly [number, number, number, number, number, number, number];
const PROFILES: Record<Exclude<ParameterKey, 'tempo'>, Profile> = {
  tension: [.16, .10, .28, .67, .93, .025, .07],
  harmonicMobility: [.20, .27, .43, .86, .91, .10, .23],
  harmonicSurprise: [.15, .08, .26, .68, .67, .06, .04],
  voiceLeading: [.97, .93, .94, .88, .80, 1, .97],
  tonalClarity: [.86, .88, .83, .45, .6, .94, .94],
  tonalGravity: [.84, .84, .82, .43, .58, .90, .92],
  dissonance: [.10, .10, .17, .32, .43, .015, .04],
  brightness: [.40, .61, .66, .49, .85, .29, .59],
  chromaticism: [.15, .035, .17, .54, .48, .04, .025],
  intervalComplexity: [.30, .28, .45, .86, .91, .19, .26],
  quartalTendency: [.35, .14, .27, .72, .61, .29, .12],
  bassIndependence: [.28, .18, .43, .89, .79, .12, .16],
  bassMobility: [.20, .32, .43, .74, .85, .12, .28],
  melodicActivity: [.27, .72, .66, .61, .86, .16, .76],
  melodicFamiliarity: [.80, .91, .9, .73, .84, .86, .98],
  motifRecurrence: [.48, .91, .88, .46, .72, .62, 1],
  motifTransformation: [.20, .07, .28, .90, .63, .18, .035],
  rhythmicComplexity: [.19, .20, .39, .79, .86, .08, .16],
  rhythmicPredictability: [.84, .85, .83, .40, .58, .95, .92],
  rhythmicDensity: [.13, .45, .41, .56, .84, .035, .42],
  metricStability: [.94, .93, .86, .47, .65, .98, .97],
  texturalDensity: [.33, .54, .49, .74, .95, .12, .53],
  dynamics: [.32, .64, .57, .75, .98, .14, .67],
  ideaDensity: [.12, .4, .52, .68, .82, .08, .35],
  ensembleSize: [.23, .5, .55, .67, .96, .08, .55],
};
type CharacterKey = Exclude<ParameterKey, 'tempo'>;
const CHARACTER_AXES: Record<CharacterKey, readonly [string, number]> = {
  tension: ['intensity', 1], dynamics: ['intensity', 1], texturalDensity: ['activity', 1],
  harmonicMobility: ['motion', 1], harmonicSurprise: ['motion', 1], voiceLeading: ['motion', -.45],
  bassIndependence: ['motion', 1], bassMobility: ['motion', 1],
  tonalClarity: ['ambiguity', -1], tonalGravity: ['ambiguity', -1], dissonance: ['ambiguity', 1], chromaticism: ['ambiguity', 1],
  brightness: ['color', 1], intervalComplexity: ['color', 1], quartalTendency: ['color', 1],
  melodicActivity: ['activity', 1], rhythmicComplexity: ['activity', 1], rhythmicDensity: ['activity', 1],
  rhythmicPredictability: ['activity', -1], metricStability: ['activity', -.65],
  melodicFamiliarity: ['novelty', -1], motifRecurrence: ['novelty', -1], motifTransformation: ['novelty', 1],
  ideaDensity: ['novelty', 1], ensembleSize: ['ensemble', 1],
};
type Bounds = Partial<Record<CharacterKey, readonly [number, number]>>;
const HOME_BOUNDS: Bounds = {
  tension: [.03, .25], tonalClarity: [.7, .99], tonalGravity: [.58, .99], dissonance: [.015, .23], chromaticism: [0, .22],
  voiceLeading: [.76, 1], melodicActivity: [.45, .92], melodicFamiliarity: [.78, 1], motifRecurrence: [.74, 1],
  motifTransformation: [0, .2], metricStability: [.74, 1], rhythmicPredictability: [.62, 1],
};
const ROLE_BOUNDS: Partial<Record<FormRole, Bounds>> = {
  intro: { tension: [.07, .3], dynamics: [.2, .48], melodicActivity: [.12, .4], rhythmicDensity: [.04, .3], texturalDensity: [.15, .5], tonalClarity: [.84, 1], dissonance: [0, .15] },
  development: { tension: [.5, .82], tonalClarity: [.25, .68], dissonance: [.18, .65], melodicFamiliarity: [.5, .92] },
  climax: { tension: [.9, 1], dynamics: [.92, 1], melodicActivity: [.68, 1], rhythmicDensity: [.65, 1], dissonance: [.18, .72], melodicFamiliarity: [.62, .99] },
  breakdown: { tension: [0, .09], dynamics: [.015, .12], melodicActivity: [.02, .2], rhythmicDensity: [.005, .13], texturalDensity: [.025, .2], tonalClarity: [.82, 1] },
  return: { motifRecurrence: [.98, 1], motifTransformation: [0, .07] },
};
function targetFor(seed: string, sectionIndex: number, role: FormRole, key: CharacterKey, freedom: number): number {
  const roleIndex = ROLES.indexOf(role);
  const [axis, direction] = CHARACTER_AXES[key];
  // Correlated seed character makes a recognizable piece; section expression
  // creates contrasting readings of that character. Freedom broadens both,
  // while role bounds preserve consonant hooks and genuine peaks and release.
  const identity = (random(seed, 'form-character', axis) * 2 - 1) * direction;
  const expression = random(seed, 'form-section-expression', sectionIndex, axis) * 2 - 1;
  const detail = random(seed, 'form-section-detail', sectionIndex, key) * 2 - 1;
  const target = PROFILES[key][roleIndex] + freedom * freedom * (identity * .24 + expression * .14 + detail * .055);
  const bounds = ROLE_BOUNDS[role]?.[key] ?? (role === 'theme' || role === 'return' ? HOME_BOUNDS[key] : undefined) ?? [0, 1];
  return clamp(target, bounds[0], bounds[1]);
}

/** Retain the harmonic role while preparing the next over several true bars.
 * A shared absolute-time contour carries expressive approach and release
 * through thought boundaries, with much quieter calm sections. Tempo stays
 * at the chosen base BPM: dynamics and rhythm convey energy without moving the
 * pulse. Manual automation is applied afterwards and still takes priority.
 */
export function conductParameters(seed: string, tick: number, baseParams: Parameters, config: ConductorConfig, homeTuning: TuningId = '12tet'): Parameters {
  if (!config.enabled || unit(config.amount, DEFAULT_CONDUCTOR.amount) === 0) return { ...baseParams };
  const base = normalizeParameters(baseParams), form = formAt(seed, tick, config, homeTuning);
  const next = formAt(seed, form.sectionEndTick, config, homeTuning);
  const amount = unit(config.amount, DEFAULT_CONDUCTOR.amount);
  const sectionBars = (form.sectionEndTick - form.sectionStartTick) / form.barTicks;
  const approachTicks = form.barTicks * clamp(sectionBars * .3, 1.5, 4);
  const transitionStart = form.sectionEndTick - approachTicks;
  const blend = next.behavior?.entry === 'cut' ? 0 : smooth(clamp((tick - transitionStart) / approachTicks));
  const expression = expressiveContourAt(seed, tick, at => formAt(seed, at, config, homeTuning));
  const position = form.phrasePosition, breath = 16 * position * position * (1 - position) * (1 - position);
  const result = { ...base };
  for (const definition of PARAMETER_DEFINITIONS) {
    const key = definition.key;
    // These are baseline preferences for the shared expressive policy. Moving
    // them here first would erase literal sparse/solo or dense/tutti endpoints.
    if (key === 'tempo' || key === 'ideaDensity' || key === 'ensembleSize') continue;
    const from = targetFor(seed, form.sectionIndex, form.role, key, amount), to = targetFor(seed, next.sectionIndex, next.role, key, amount);
    const wave = (random(seed, 'form-phrase-color', form.phraseIndex, key) - .35) * .035 * breath;
    let target = from + (to - from) * blend + wave;
    if (key === 'dynamics') target = target * .15 + expression.intensity * .85;
    else if (key === 'rhythmicDensity') target *= .35 + expression.activity * .95;
    else if (key === 'rhythmicComplexity') target = target * .45 + expression.activity * .55;
    else if (key === 'texturalDensity') target = target * .25 + (.08 + (expression.ensembleSize ?? expression.intensity) * .85) * .75;
    else if (key === 'melodicActivity') target = target * .65 + (.2 + expression.activity * .75) * .35;
    else if (key === 'brightness') target = target * .85 + expression.register * .15;
    else if (key === 'tension') target = target * .8 + expression.energy * .2;
    result[key] = clamp(base[key] + (target - base[key]) * amount, definition.min, definition.max);
  }
  return result;
}
