import type { HarmonyConfig } from '../harmonic-language';
import type { TuningId } from '../pitch';
import { nativeSpace } from './native-space';
import { FRAME_TICKS } from '../types';
import { random } from './random';
import { choosePlannedIdea, type IdeaPlan, type PlannedIdea, type ToolCoverage } from './idea-selection';

export type HarmonicQuality = 'major' | 'minor' | 'dominant' | 'diminished' | 'suspended';
export type CadenceKind = 'authentic' | 'half' | 'plagal' | 'deceptive';
export interface MelodyAnchor { cents: number; weight: number; }
export interface HarmonicDestination {
  id: string; startTick: number; endTick: number; root: number; region: number;
  quality: HarmonicQuality; pitchClasses: number[];
  function: 'tonic' | 'predominant' | 'dominant' | 'color' | 'arrival';
  operation: string; cadence: CadenceKind | null; strategy: HarmonyConfig['strategy']; melodyFit: number;
}
export type HarmonicTool = 'function' | 'P' | 'R' | 'L' | 'third-cycle' | 'secondary-dominant' | CadenceKind;
export interface HarmonicRoute {
  id: string; destinations: HarmonicDestination[]; cadence: CadenceKind | null; score: number;
  evaluation?: Readonly<Record<string, number>>; candidatesEvaluated?: number; tools?: readonly string[]; coverage?: ToolCoverage;
}
export interface HarmonicRouteInput {
  seed: string; phraseId: string; themeId: string; occurrence: number;
  startTick: number; endTick: number; barTicks: number; tuning: TuningId;
  /** Native pitch class: MIDI class in twelve-tone, degree relative to A4 in nineteen. */
  center: number; third: 3 | 4; cadence: 'open' | 'closed'; config: HarmonyConfig;
  melodyTargetsAt?: (tick: number, duration: number) => readonly number[];
  /** Weights describe actual overlap duration and structural importance. */
  melodyAnchorsAt?: (tick: number, duration: number) => readonly MelodyAnchor[];
  plan?: IdeaPlan;
}

const mod = (n: number, period: number) => ((n % period) + period) % period;
const round = (n: number) => Math.round(n * 1e6) / 1e6;
const TABLE = {
  '12tet': { period: 12, fifth: 7, fourth: 5, second: 2, sixth: 9, minorSixth: 8,
    thirds: [0, 4, 8], major: [0, 4, 7], minor: [0, 3, 7], dominant: [0, 4, 7, 10], diminished: [0, 3, 6], suspended: [0, 5, 7] },
  '19edo': { period: 19, fifth: 11, fourth: 8, second: 3, sixth: 14, minorSixth: 13,
    thirds: [0, 6, 12], major: [0, 6, 11], minor: [0, 5, 11], dominant: [0, 6, 11, 16], diminished: [0, 5, 10], suspended: [0, 8, 11] },
  '24edo': { period: 24, fifth: 14, fourth: 10, second: 4, sixth: 19, minorSixth: 15,
    thirds: [0, 9, 17], major: [0, 9, 14], minor: [0, 5, 14], dominant: [0, 9, 14, 20], diminished: [0, 5, 12], suspended: [0, 10, 14] },
  '31edo': { period: 31, fifth: 18, fourth: 13, second: 5, sixth: 23, minorSixth: 21,
    thirds: [0, 10, 20], major: [0, 10, 18], minor: [0, 8, 18], dominant: [0, 10, 18, 26], diminished: [0, 8, 16], suspended: [0, 13, 18] },
} as const;

/** Explicit native analogues. Nineteen uses a 6/6/7 region cycle, not an
 * endless +6 traversal which would miss its home on the third arrival. */
export function harmonicSequenceOffset(seed: string, themeId: string, occurrence: number, tuning: TuningId, config: HarmonyConfig): number {
  if (config.treatment !== 'sequence') return 0;
  const direction = random(seed, 'harmonic-sequence', themeId, 'direction') < .5 ? 1 : -1;
  const index = mod(Math.max(0, Math.floor(occurrence)) * direction, 3);
  return TABLE[tuning].thirds[index];
}

export function harmonicPitchClasses(root: number, quality: HarmonicQuality, tuning: TuningId): number[] {
  const table = TABLE[tuning];
  return table[quality].map(interval => mod(root + interval, table.period));
}

/** P/R/L are typed triad relations preserving two native tones. They do not
 * claim to supply harmonic function or a cadence on their own. */
export function transformTriad(root: number, quality: 'major' | 'minor', operation: 'P' | 'R' | 'L', tuning: TuningId): { root: number; quality: 'major' | 'minor' } {
  const table = TABLE[tuning], major = quality === 'major';
  const shift = operation === 'P' ? 0 : operation === 'R'
    ? (major ? table.sixth : table.minor[1]) : (major ? table.major[1] : table.period - table.major[1]);
  return { root: mod(root + shift, table.period), quality: major ? 'minor' : 'major' };
}

/** Match the actual registers on their native grid; no pitch-class labels are
 * inferred from a random sonority. Root in the bass is a separate fact. */
export function harmonicRealization(destination: HarmonicDestination, upper: readonly number[], bass: number, tuning: TuningId) {
  const period = TABLE[tuning].period, classes = new Set([...upper, bass].map(pitch => mod(pitch, period)));
  const essential = destination.pitchClasses;
  const chordToneFraction = [...upper, bass].filter(pitch => destination.pitchClasses.includes(mod(pitch, period))).length / (upper.length + 1);
  const essentialToneFraction = essential.filter(pitch => classes.has(pitch)).length / essential.length;
  const rootPresent = classes.has(destination.root), bassOnRoot = mod(bass, period) === destination.root;
  return { rootPresent, bassOnRoot, chordToneFraction: round(chordToneFraction), essentialToneFraction: round(essentialToneFraction),
    matched: bassOnRoot && essentialToneFraction === 1 && chordToneFraction === 1 };
}

/** Structural bars only; the harmony planner commits on a 960-tick grid. */
export function harmonicWindowTicks(barTicks: number, config?: HarmonyConfig): number {
  const bars = config && config.functionalMotion >= .4 && barTicks % FRAME_TICKS === 0 ? 1
    : (barTicks * 2) % FRAME_TICKS === 0 ? 2 : 4;
  return barTicks * bars;
}

function melodyFit(classes: readonly number[], anchors: readonly MelodyAnchor[], tuning: TuningId): number {
  const targets = anchors.filter(anchor => Number.isFinite(anchor.cents) && Number.isFinite(anchor.weight) && anchor.weight > 0);
  if (!targets.length) return .7;
  const { period } = TABLE[tuning];
  const values = targets.map(({ cents, weight }) => {
    const target = mod(Math.round(tuning === '12tet' ? cents / 100 : (cents - 6900) * period / 1200), period);
    if (classes.includes(target)) return weight;
    // A whole step/ninth can be a supported suspension. A held chromatic
    // neighbor against the destination is less compatible, not forbidden.
    const nearest = Math.min(...classes.map(pitch => Math.min(mod(target - pitch, period), mod(pitch - target, period)))) * 1200 / period;
    return (nearest < 160 ? .1 : nearest < 260 ? .62 : .42) * weight;
  });
  return values.reduce((sum, value) => sum + value, 0) / targets.reduce((sum, anchor) => sum + anchor.weight, 0);
}

/** Vocabulary is scoped by the declared language, not by what happened to win
 * a particular route. Inapplicable opportunities are reported as deferred. */
export function harmonicVocabulary(config: HarmonyConfig, cadence?: 'open' | 'closed'): HarmonicTool[] {
  const tools: HarmonicTool[] = ['function', ...(cadence === 'open' ? [] : ['authentic', 'plagal'] as const),
    ...(cadence === 'closed' ? [] : ['half', 'deceptive'] as const)];
  if (config.strategy === 'tonnetz' || config.strategy === 'balanced' && config.harmonicColor > 0) tools.push('P', 'R', 'L');
  if (config.strategy === 'third-cycle' || config.strategy === 'balanced' && config.harmonicColor > 0) tools.push('third-cycle');
  if (['balanced', 'functional'].includes(config.strategy) && config.harmonicColor > 0) tools.push('secondary-dominant');
  return tools;
}

interface RouteChord {
  root: number; quality: HarmonicQuality; function: HarmonicDestination['function']; operation: string; region: number;
  tools: HarmonicTool[]; resolves?: { root: number; quality: HarmonicQuality; operation: string }; direction?: number;
}
interface RouteEnding { cadence: CadenceKind | null; chords: RouteChord[]; }

/** Build complete feasible alternatives from the same native relations at
 * every phrase length. Preparation and arrival are one indivisible suffix;
 * prefix expansion must discharge its obligations before entering that suffix. */
export function proposeHarmonicRoutes(input: HarmonicRouteInput): PlannedIdea<HarmonicRoute>[] {
  const { seed, phraseId, themeId, occurrence, config, tuning } = input;
  if (![input.startTick, input.endTick, input.barTicks].every(Number.isSafeInteger)
    || input.startTick < 0 || input.endTick <= input.startTick || input.barTicks <= 0)
    throw new RangeError('A harmonic argument needs a bounded integer clock.');
  const table = TABLE[tuning], home = mod(input.center, table.period), minor = input.third === 3;
  const span = harmonicWindowTicks(input.barTicks, config);
  if (!Number.isSafeInteger(span) || span <= 0 || Math.ceil((input.endTick - input.startTick) / span) > 128)
    throw new RangeError('A harmonic argument needs a safe span and at most 128 windows.');
  const windows: { startTick: number; endTick: number; anchors: readonly MelodyAnchor[] }[] = [];
  for (let tick = input.startTick; tick < input.endTick; tick += span) {
    const endTick = Math.min(input.endTick, tick + span);
    windows.push({ startTick: tick, endTick, anchors: input.melodyAnchorsAt?.(tick, endTick - tick)
      ?? (input.melodyTargetsAt?.(tick, endTick - tick) ?? []).map(cents => ({ cents, weight: 1 })) });
  }
  const tonicQuality = minor ? 'minor' : 'major';
  const chord = (root: number, quality: HarmonicQuality, fn: RouteChord['function'], operation: string,
    tools: HarmonicTool[] = [], region = home): RouteChord =>
    ({ root: mod(root, table.period), quality, function: fn, operation, tools, region: mod(region, table.period) });
  const tonic = (operation = 'tonic statement', fn: RouteChord['function'] = 'tonic') => chord(home, tonicQuality, fn, operation);
  const dominant = (region = home, operation = 'dominant preparation', tools: HarmonicTool[] = ['function']): RouteChord => ({
    ...chord(region + table.fifth, 'dominant', 'dominant', operation, tools, region),
    resolves: { root: mod(region, table.period), quality: region === home ? tonicQuality : 'major',
      operation: operation === 'third-cycle dominant' ? 'third-cycle arrival' : 'dominant resolution' },
  });
  const relative = (operation: string) => chord(home + (minor ? table.minorSixth : table.sixth), minor ? 'major' : 'minor', 'tonic', operation, ['function']);
  const secondaryDominant = (): RouteChord => ({ ...dominant(home + table.fifth, 'secondary dominant of V', ['function', 'secondary-dominant']),
    resolves: { root: mod(home + table.fifth, table.period), quality: 'dominant', operation: 'secondary dominant resolution' } });
  const predominant = (second: boolean) => ({
    ...chord(home + (second ? table.second : table.fourth), second ? minor ? 'diminished' : 'minor' : tonicQuality,
      'predominant', second ? 'supertonic preparation' : 'subdominant expansion', ['function']),
    ...(second && minor ? { resolves: { root: mod(home + table.fifth, table.period), quality: 'dominant' as const, operation: 'diminished predominant resolution' } } : {}),
  });
  const relation = (previous: RouteChord, operation: 'P' | 'R' | 'L', substitution = false): RouteChord => {
    const transformed = transformTriad(previous.root, previous.quality as 'major' | 'minor', operation, tuning);
    return chord(transformed.root, transformed.quality, 'color', `${operation} ${substitution ? 'related-tonic substitute' : 'common-tone relation'}`, [operation]);
  };
  const regional = (previous: RouteChord, direction: number, prepare: boolean): RouteChord => {
    const stage = Math.max(0, table.thirds.findIndex(offset => mod(home + offset, table.period) === previous.region));
    const region = mod(home + table.thirds[mod(stage + direction, 3)], table.period);
    return { ...(prepare ? dominant(region, 'third-cycle dominant', ['third-cycle'])
      : chord(region, 'major', 'color', 'third-cycle region', ['third-cycle'], region)), direction };
  };
  const languages = config.strategy === 'balanced' ? ['functional', ...(config.harmonicColor > 0 ? ['tonnetz', 'third-cycle'] : [])]
    : [config.strategy];
  const coloredOpenings = () => [
    ...(languages.includes('tonnetz') ? (['P', 'R', 'L'] as const).map(operation => relation(tonic(), operation, true)) : []),
    ...(languages.includes('third-cycle') ? [-1, 1].map(direction => regional(tonic(), direction, false)) : []),
  ];
  const endings: RouteEnding[] = input.cadence === 'closed' ? [
    { cadence: 'authentic', chords: [dominant(), tonic('authentic arrival', 'arrival')] },
    { cadence: 'plagal', chords: [{ ...predominant(false), operation: 'plagal preparation' }, tonic('plagal arrival', 'arrival')] },
  ] : [
    ...[true, false].map(second => ({ cadence: 'half' as const, chords: [
      { ...predominant(second), operation: 'predominant preparation' }, { ...dominant(), function: 'arrival' as const, operation: 'half cadence' },
    ] })),
    { cadence: 'deceptive', chords: [dominant(), { ...relative('deceptive arrival'), function: 'arrival' }] },
  ];
  const requiredNext = (previous: RouteChord): RouteChord | undefined => previous.resolves && {
    ...chord(previous.resolves.root, previous.resolves.quality, previous.resolves.quality === 'dominant' ? 'dominant'
      : previous.region === home ? 'tonic' : 'color', previous.resolves.operation, previous.tools,
    previous.resolves.quality === 'dominant' ? home : previous.region),
    ...(previous.resolves.quality === 'dominant' ? { resolves: dominant().resolves } : {}), direction: previous.direction,
  };
  const extendsTo = (previous: RouteChord | undefined, next: RouteChord) => !previous?.resolves
    || previous.resolves.root === next.root && previous.resolves.quality === next.quality;
  const extensions = (path: RouteChord[], remaining: number): RouteChord[] => {
    const previous = path.at(-1)!, required = requiredNext(previous);
    if (required) return [required];
    const options: RouteChord[] = [];
    if (languages.includes('functional')) {
      if (previous.function === 'predominant') options.push({ ...dominant(), operation: 'predominant to dominant' });
      else {
        options.push(predominant(true), predominant(false), relative('relative expansion'));
        if (config.harmonicColor > 0) options.push(secondaryDominant());
      }
    }
    if (languages.includes('tonnetz') && ['major', 'minor'].includes(previous.quality))
      options.push(...(['P', 'R', 'L'] as const).map(operation => relation(previous, operation)));
    if (languages.includes('third-cycle')) {
      const direction = path.find(item => item.direction !== undefined)?.direction;
      options.push(...(direction === undefined ? [-1, 1] : [direction]).map(value => regional(previous, value, remaining >= 2)));
    }
    return options;
  };
  const key = (path: RouteChord[]) => path.map(item => `${item.root}:${item.quality}:${item.operation}`).join('/');
  const retracing = (path: RouteChord[]) => path.slice(2).filter((item, index) => item.root === path[index].root
    && item.quality === path[index].quality).length;
  const paths: RouteEnding[] = [];
  if (windows.length === 1) {
    const openings = input.cadence === 'closed' ? [tonic()] : [...(languages.includes('functional') ? [tonic()] : []), ...coloredOpenings()];
    paths.push(...openings.map(item => ({ cadence: null, chords: [item] })));
  } else {
    if (windows.length > 2 || languages.includes('functional')) {
      const prefixLength = windows.length - 2;
      let prefixes: RouteChord[][] = [[]];
      for (let index = 0; index < prefixLength; index++) {
        const next = prefixes.flatMap(path => (index ? extensions(path, prefixLength - index)
          : [...(prefixLength > 1 || languages.includes('functional') ? [tonic()] : []), ...coloredOpenings(),
            ...(languages.includes('functional') && config.harmonicColor > 0 ? [secondaryDominant()] : []),
            ...(config.treatment === 'reharmonize' && occurrence > 0 && languages.includes('functional') ? [relative('relative substitute')] : [])])
          .map(item => [...path, item]));
        const ranked = [...new Map(next.filter(path => index < prefixLength - 1 || endings.some(ending => extendsTo(path.at(-1), ending.chords[0])))
          .map(path => [key(path), path])).values()].map(path => ({ path, cost: path.reduce((sum, item, at) =>
          sum + (1 - melodyFit(harmonicPitchClasses(item.root, item.quality, tuning), windows[at].anchors, tuning)) * 4, 0) + retracing(path) * .7 }))
          .sort((a, b) => a.cost - b.cost || (key(a.path) < key(b.path) ? -1 : key(a.path) > key(b.path) ? 1 : 0));
        // Bound search while retaining the best actual use of each technique.
        // A large cheap family cannot remove an entire feasible vocabulary.
        const retained = new Map(ranked.slice(0, 32).map(item => [key(item.path), item.path]));
        for (const tool of harmonicVocabulary(config)) {
          const best = ranked.find(item => item.path.some(chord => chord.tools.includes(tool)));
          if (best) retained.set(key(best.path), best.path);
        }
        if (index === prefixLength - 1) for (const ending of endings) {
          const best = ranked.find(item => extendsTo(item.path.at(-1), ending.chords[0]));
          if (best) retained.set(key(best.path), best.path);
        }
        prefixes = [...retained.values()];
      }
      for (const prefix of prefixes) for (const ending of endings) if (extendsTo(prefix.at(-1), ending.chords[0]))
        paths.push({ ...ending, chords: [...prefix, ...ending.chords] });
    }
    if (windows.length === 2) for (const opening of coloredOpenings()) {
      const related = opening.tools.find(tool => ['P', 'R', 'L'].includes(tool));
      const closed = input.cadence === 'closed';
      const departure = { ...opening, operation: related ? `${related} common-tone ${closed ? 'preparation' : 'relation'}` : opening.operation };
      const arrival = related ? { ...relation(departure, related as 'P' | 'R' | 'L'), function: 'arrival' as const }
        : { ...tonic('third-cycle return', 'arrival'), tools: ['third-cycle' as const] };
      paths.push({ cadence: null, chords: closed ? [departure, arrival] : [tonic(), departure] });
    }
  }
  return [...new Map(paths.map(path => [`${path.cadence}:${key(path.chords)}`, path])).entries()].map(([identity, path]) => {
    const tools = [...new Set([...path.chords.flatMap(item => item.tools), ...(path.cadence ? [path.cadence] : [])])];
    const destinations = path.chords.map((item, index): HarmonicDestination => {
      const { tools: _tools, resolves: _resolves, direction: _direction, ...destination } = item;
      const classes = harmonicPitchClasses(item.root, item.quality, tuning);
      return { ...destination, startTick: windows[index].startTick, endTick: windows[index].endTick, id: `${phraseId}:h${index}`, pitchClasses: classes,
        melodyFit: round(melodyFit(classes, windows[index].anchors, tuning)),
        cadence: index >= path.chords.length - 2 ? path.cadence : null, strategy: config.strategy };
    });
    const departure = tools.includes('third-cycle') ? 1 : tools.some(tool => ['P', 'R', 'L'].includes(tool)) ? .45 : tools.includes('secondary-dominant') ? .3 : 0;
    const costs = {
      melody: destinations.reduce((sum, item) => sum + (1 - item.melodyFit) * 4 * (item.endTick - item.startTick), 0) / (input.endTick - input.startTick),
      repetition: path.chords.slice(1).filter((item, index) => item.root === path.chords[index].root && item.quality === path.chords[index].quality).length
        * .7 * config.functionalMotion / path.chords.length,
      retracing: retracing(path.chords) * .7 / path.chords.length,
      departure: config.strategy === 'balanced' ? Math.abs(departure - config.harmonicColor) : 0,
      cadence: path.cadence === 'plagal' ? config.cadenceStrength * .04 : path.cadence === 'deceptive' ? config.functionalMotion * .035
        : !path.cadence && windows.length >= 2 ? config.functionalMotion * .15 + (input.cadence === 'closed' ? config.cadenceStrength * .35 : 0) : 0,
      preference: random(seed, 'harmonic-preference', themeId, occurrence, phraseId, identity) * .08,
    };
    return { id: `${phraseId}:${identity}`, tools, costs,
      value: { id: `${phraseId}:route`, destinations, cadence: path.cadence, score: round(4 - Object.values(costs).reduce((sum, cost) => sum + cost, 0)) } };
  });
}

export function planHarmonicRoute(input: HarmonicRouteInput): HarmonicRoute {
  const choice = choosePlannedIdea(input.seed, `harmony:${input.phraseId}`, proposeHarmonicRoutes(input), input.plan);
  return { ...choice.value, evaluation: choice.costs, candidatesEvaluated: choice.candidates, tools: choice.tools,
    ...(choice.coverage ? { coverage: choice.coverage } : {}) };
}

export function harmonicDestinationAt(route: HarmonicRoute, tick: number): HarmonicDestination | undefined {
  return route.destinations.find(destination => tick >= destination.startTick && tick < destination.endTick);
}

/** Place the chosen identity, including a real root bass, with a nearest-voice
 * beam. All four voices may move; register/order and semantic chord membership
 * are hard constraints, while small motion ranks complete native voicings. */
export function destinationProposals(upper: readonly number[], bass: number, destination: HarmonicDestination, tuning: TuningId,
  ranges: readonly (readonly [number, number])[], bassRange: readonly [number, number]): { voices: number[]; bass: number }[] {
  const period = TABLE[tuning].period, space = tuning === '12tet' ? undefined : nativeSpace(tuning);
  const minGap = space?.minimumGap ?? 2, maxGap = space?.maximumGap ?? 14;
  let beam: { voices: number[]; cost: number }[] = [{ voices: [], cost: 0 }];
  for (let voice = 0; voice < 4; voice++) {
    const options: number[] = [];
    for (let pitch = ranges[voice][0]; pitch <= ranges[voice][1]; pitch++) if (destination.pitchClasses.includes(mod(pitch, period))) options.push(pitch);
    options.sort((a, b) => Math.abs(a - upper[voice]) - Math.abs(b - upper[voice]) || a - b);
    const next: typeof beam = [];
    for (const node of beam) for (const pitch of options.slice(0, 7)) {
      const previous = node.voices.at(-1), gap = previous === undefined ? 0 : pitch - previous;
      if (previous !== undefined && (gap < minGap || gap > maxGap)) continue;
      const movement = Math.abs(pitch - upper[voice]) * 12 / period;
      next.push({ voices: [...node.voices, pitch], cost: node.cost + movement + Math.max(0, movement - 2) ** 2 * .3 });
    }
    next.sort((a, b) => a.cost - b.cost || (a.voices.join(',') < b.voices.join(',') ? -1 : 1));
    beam = next.slice(0, 48);
  }
  const lowers: number[] = [];
  for (let pitch = bassRange[0]; pitch <= bassRange[1]; pitch++) if (mod(pitch, period) === destination.root) lowers.push(pitch);
  lowers.sort((a, b) => Math.abs(a - bass) - Math.abs(b - bass) || a - b);
  const result: { voices: number[]; bass: number }[] = [];
  for (const node of beam) for (const lower of lowers) if (lower <= node.voices[0] - (space?.bassGap ?? 7)
    && node.voices[3] - node.voices[0] <= (space?.span ?? 31)
    && harmonicRealization(destination, node.voices, lower, tuning).matched) result.push({ voices: node.voices, bass: lower });
  return result.slice(0, 48);
}
