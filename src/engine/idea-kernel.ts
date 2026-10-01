import { random } from './random';

const clamp = (value: number, low = 0, high = 1) => Math.max(low, Math.min(high, value));

export interface IdeaCell {
  id: string;
  units: number;
  pulseUnits: number;
  /** Ordered group durations, in the same integer units as attacks. */
  groups: number[];
  attacks: Array<{ unit: number; strength: number; holdUnits: number }>;
}
export interface MetricContext {
  originTick: number; beatTicks: number; barTicks: number;
  /** Optional group durations in beats; the group origin is the bar origin. */
  groups?: readonly number[];
}

const modulo = (value: number, period: number) => {
  const remainder = value % period;
  return remainder < 0 ? remainder + period : remainder;
};
const gcd = (a: number, b: number): number => {
  while (b) [a, b] = [b, a % b];
  return a;
};

/** The depth of a rational position in a pulse: halves cost one level,
 * thirds log2(3), quarters two. Tuplets therefore retain their own hierarchy
 * instead of falling into an undifferentiated offbeat bucket. */
function pulseDepth(offset: number, pulse: number): number {
  const position = modulo(offset, pulse);
  if (position === 0) return 0;
  if (Number.isSafeInteger(position) && Number.isSafeInteger(pulse))
    return Math.log2(pulse / gcd(position, pulse));
  // Metric readers can receive a fractional beat length. Recognize small
  // rational divisions without mistaking floating-point error for free time.
  for (let denominator = 2; denominator <= 64; denominator++) {
    const fraction = position / pulse * denominator;
    if (Math.abs(fraction - Math.round(fraction)) < 1e-8) return Math.log2(denominator);
  }
  return 7;
}

/** Continuous structural depth: bar 0, group .5, pulse 1, and rational
 * subdivisions below it. Independent of orchestration and random state. */
export function metricDepth(tick: number, context: MetricContext): number {
  const { originTick, beatTicks: beat, barTicks: bar } = context;
  if (![tick, originTick, beat, bar].every(Number.isFinite) || beat <= 0 || bar <= 0)
    throw new RangeError('Meter needs finite positions and positive beat and bar lengths.');
  const position = modulo(tick - originTick, bar);
  if (position === 0) return 0;
  let boundary = 0;
  for (const group of context.groups ?? []) {
    if (!Number.isFinite(group) || group <= 0) throw new RangeError('Metric groups must have positive finite durations.');
    boundary += group * beat;
    if (Math.abs(position - boundary) < 1e-8) return .5;
  }
  return 1 + pulseDepth(position, beat);
}

/** Audible accents follow the same rational hierarchy as subdivision choices. */
export function metricStrength(tick: number, context: MetricContext): number {
  const depth = metricDepth(tick, context);
  if (depth === 0) return 1;
  if (depth === .5) return .91;
  if (depth === 1) return .78;
  return Math.max(.08, .56 * Math.exp(-.7 * (depth - 2)));
}

export interface TargetSubdivision {
  startTick: number; endTick: number; gridTicks: number; attackBudget: number;
  anchors?: readonly { tick: number; strength?: number }[];
  syncopation?: number; pulseTicks?: number; originTick?: number; direction?: number;
  /** Exponential cost of one extra subdivision level; higher values favor
   * structural attacks. Syncopation reduces this cost without reversing it. */
  hierarchyDecay?: number;
}
export interface SubdividedAttack {
  tick: number; durationTicks: number; strength: number;
  level: 'goal' | 'pulse' | 'subdivision';
}

/** Refine a tree of spaces between written targets. Each gap offers a bounded
 * frontier of rational subdivisions, sampled with an addressed exponential
 * race. Rates decrease exponentially with metrical depth and increase with
 * unmet space, balance and directed density. A larger budget traverses the
 * same tree further, preserving every existing attack. */
export function subdivideBetweenTargets(seed: string, address: string, input: TargetSubdivision): SubdividedAttack[] {
  const { startTick, endTick, gridTicks } = input;
  if (![startTick, endTick, gridTicks].every(Number.isSafeInteger) || startTick < 0 || endTick <= startTick || gridTicks < 1)
    throw new RangeError('Subdivision needs ordered integer endpoints and a positive integer grid.');
  const span = endTick - startTick, pulse = input.pulseTicks ?? gridTicks * 4;
  const origin = input.originTick ?? startTick;
  if (!Number.isSafeInteger(pulse) || pulse < 1 || !Number.isSafeInteger(origin)
    || !Number.isSafeInteger(startTick - origin) || !Number.isSafeInteger(endTick - origin)
    || ![input.attackBudget, input.syncopation ?? .2, input.direction ?? 0, input.hierarchyDecay ?? 1.8].every(Number.isFinite))
    throw new RangeError('Subdivision needs a finite budget and controls, an integer pulse and a safe integer origin.');
  const syncopation = clamp(input.syncopation ?? .2);
  const direction = clamp(input.direction ?? 0, -1, 1);
  const decay = Math.max(0, input.hierarchyDecay ?? 1.8) * (1 - syncopation * .75);
  const anchors = new Map<number, number>([[startTick, 1]]);
  for (const anchor of input.anchors ?? []) {
    if (!Number.isSafeInteger(anchor.tick) || !Number.isFinite(anchor.strength ?? .94))
      throw new RangeError('Subdivision anchors need integer ticks and finite strengths.');
    if (anchor.tick >= startTick && anchor.tick < endTick)
      anchors.set(anchor.tick, Math.max(anchors.get(anchor.tick) ?? 0, clamp(anchor.strength ?? .94)));
  }
  const points = [...anchors.keys()].sort((a, b) => a - b);
  if (points.length > 128) throw new RangeError('Subdivision supports at most 128 distinct structural targets.');
  const budget = Math.max(points.length, Math.min(128, Math.max(1, Math.round(input.attackBudget))));
  // A grid/pulse ratio is rational even when neither divides the other.
  // All pulse boundaries are multiples of `period` grid slots. Include small
  // factors and their complements, so sparse long spans never lose their
  // pulses to a fixed evenly sampled list of candidate ticks.
  const period = pulse / gcd(gridTicks, pulse), strides = new Set<number>([period, 1]);
  for (let divisor = 2; divisor <= 32; divisor++) if (period % divisor === 0) {
    strides.add(period / divisor); strides.add(divisor);
  }
  const depthAt = (at: number) => pulseDepth(at - origin, pulse);
  const metric = (at: number) => at === origin ? 1 : depthAt(at) === 0 ? .78
    : Math.max(.08, .56 * Math.exp(-.7 * (depthAt(at) - 1)));
  interface Split { left: number; right: number; tick: number; priority: number; }
  const frontier: Split[] = [];
  const offer = (left: number, right: number) => {
    // Authored off-grid targets are retained exactly. New detail must remain
    // at least one grid unit from either neighbor, avoiding tiny slivers.
    const low = Math.ceil((left - origin) / gridTicks) + 1, high = Math.floor((right - origin) / gridTicks) - 1;
    if (high < low) return;
    const candidates = new Set<number>();
    for (const stride of strides) {
      const first = Math.ceil(low / stride), last = Math.floor(high / stride);
      if (first > last) continue;
      const middle = first + (last - first) / 2;
      candidates.add(Math.floor(middle) * stride);
      candidates.add(Math.ceil(middle) * stride);
      candidates.add((first + Math.floor(random(seed, 'idea-frontier', address, left, right, stride) * (last - first + 1))) * stride);
    }
    let best: Split | undefined;
    for (const slot of candidates) {
      const tick = origin + slot * gridTicks;
      if (!Number.isSafeInteger(tick) || tick - left < gridTicks || right - tick < gridTicks) continue;
      const balance = Math.min(tick - left, right - tick) / (right - left);
      const phase = (tick - startTick) / span;
      const logRate = Math.log((right - left) / gridTicks) + Math.log(Math.max(.01, balance)) * 2
        - decay * depthAt(tick) + direction * (phase - .5) * 2;
      const draw = random(seed, 'idea-subdivision', address, left, right, tick);
      // Compare in log space: tiny probabilities and huge spans cannot
      // underflow/overflow. The half-bin keeps the addressed draw in (0, 1).
      const priority = Math.log(-Math.log(draw + .5 / 4294967296)) - logRate;
      if (!best || priority < best.priority || priority === best.priority && tick < best.tick)
        best = { left, right, tick, priority };
    }
    if (best) frontier.push(best);
  };
  if (points.length < budget) for (let index = 0; index < points.length; index++) offer(points[index], points[index + 1] ?? endTick);
  while (points.length < budget && frontier.length) {
    let index = 0;
    for (let next = 1; next < frontier.length; next++)
      if (frontier[next].priority < frontier[index].priority
        || frontier[next].priority === frontier[index].priority && frontier[next].tick < frontier[index].tick) index = next;
    const best = frontier.splice(index, 1)[0];
    points.push(best.tick);
    if (points.length < budget) { offer(best.left, best.tick); offer(best.tick, best.right); }
  }
  points.sort((a, b) => a - b);
  return points.map((tick, index) => ({ tick, durationTicks: (points[index + 1] ?? endTick) - tick,
    strength: anchors.get(tick) ?? metric(tick), level: anchors.has(tick) ? 'goal' : metric(tick) >= .78 ? 'pulse' : 'subdivision' }));
}

/** A reusable source cell: grouping and a held goal exist before decoration.
 * Identity addresses belong to themes, not to bars or audio scheduling calls. */
export function generateIdeaCell(seed: string, identity: string, options: {
  units?: number; count?: number; complexity?: number; syncopation?: number; pulseUnits?: number;
} = {}): IdeaCell {
  if (Object.values(options).some(value => value !== undefined && !Number.isFinite(value)))
    throw new RangeError('Idea controls must be finite numbers.');
  const units = Math.max(4, Math.min(256, Math.round(options.units ?? 16)));
  const pulseUnits = Math.max(1, Math.min(units, Math.round(options.pulseUnits ?? 4)));
  const complexity = clamp(options.complexity ?? .5), syncopation = clamp(options.syncopation ?? .2);
  const count = Math.max(2, Math.min(128, units, Math.round(options.count ?? 3 + complexity * 4)));
  const groupsWanted = Math.max(1, Math.min(Math.floor(units / pulseUnits), Math.round(1 + Math.sqrt(units / pulseUnits) * (.45 + complexity * .45))));
  const groups = subdivideBetweenTargets(seed, `${identity}:grouping`, { startTick: 0, endTick: units,
    gridTicks: pulseUnits, pulseTicks: pulseUnits, attackBudget: groupsWanted, syncopation: 0 }).map(point => point.durationTicks);
  const goal = Math.min(units - 1, Math.max(pulseUnits, Math.round(units * (.6 + random(seed, 'idea-held-goal', identity) * .2) / pulseUnits) * pulseUnits));
  // The held goal is the end of the argument. Decorate its preparation while
  // preserving its residence; increasing detail must not consume the arrival.
  const attacks = [...subdivideBetweenTargets(seed, `${identity}:source`, { startTick: 0, endTick: goal, gridTicks: 1,
    pulseTicks: pulseUnits, attackBudget: count - 1, syncopation }),
    { tick: goal, strength: .95, durationTicks: units - goal }];
  return { id: `cell:${identity}`, units, pulseUnits, groups, attacks: attacks.map(point => ({ unit: point.tick,
    strength: Math.max(point.strength, metricStrength(point.tick, { originTick: 0, beatTicks: pulseUnits, barTicks: units,
      groups: groups.map(group => group / pulseUnits) })), holdUnits: point.durationTicks })) };
}

/** The source used by melody, metrical residences and rhythmic orchestration.
 * Span is generated before meter is named. Two independent draws concentrate
 * ordinary subjects near four beats, without a menu of finished meters/riffs. */
export function thematicCell(seed: string, themeId: string): IdeaCell {
  const quarterBeats = Math.round(4 + (random(seed, 'idea-span', themeId, 'extension')
    - random(seed, 'idea-span', themeId, 'contraction')) * 2.2);
  const offset = random(seed, 'idea-span', themeId, 'asymmetry') < .12 ? 2 : 0;
  const units = quarterBeats * 4 + offset;
  return generateIdeaCell(seed, themeId, { units, pulseUnits: 4,
    count: 3 + Number(random(seed, 'idea-head-size', themeId) > .35),
    complexity: .2 + random(seed, 'idea-group-complexity', themeId) * .6,
    syncopation: random(seed, 'idea-source-displacement', themeId) * .45 });
}
