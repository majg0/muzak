import { DEFAULT_WEIGHTS, PARAMETER_DEFINITIONS, PRESETS, evaluateAutomation } from './parameters';
import { TUNINGS } from './pitch';
import { DEFAULT_SOUND, type SoundConfig } from './spectrum';
import { DEFAULT_CONDUCTOR, MANUAL_CONDUCTOR, conductParameters, type ConductorConfig } from './conductor';
import { DEFAULT_PHRASING, validatePhrasing } from './phrasing';
import { resolveCompositionProfile } from './composition-profile';
import { ScoreTimeline } from './engine/score-timeline';
import { ENGINE_VERSION, type AutomationLane, type AutomationPoint, type AutomationRevision, type Bookmark, type ParameterKey, type Parameters, type Performance, type Preset, type ScoreWeights } from './types';

const STORAGE_KEY = 'continuum.presets.v1';
const MAX_JSON_LENGTH = 2_000_000;
const MAX_POINTS = 12_000;
const MAX_TICK = Number.MAX_SAFE_INTEGER;
const parameterKeys = PARAMETER_DEFINITIONS.map(def => def.key);
const scoreKeys = Object.keys(DEFAULT_WEIGHTS) as (keyof ScoreWeights)[];
const fail = (message: string): never => { throw new Error(`Invalid performance: ${message}`); };
const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
function record(value: unknown, name: string): Record<string, unknown> {
  return isRecord(value) ? value : fail(`${name} must be an object.`);
}
function string(value: unknown, name: string, max = 256): string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max ? value : fail(`${name} must be text between 1 and ${max} characters.`);
}
function number(value: unknown, name: string, min: number, max: number, integer = false): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max && (!integer || Number.isSafeInteger(value)) ? value : fail(`${name} is outside its valid range.`);
}
function array(value: unknown, name: string, max: number): unknown[] {
  return Array.isArray(value) && value.length <= max ? value : fail(`${name} must be an array with at most ${max} entries.`);
}
function parameters(value: unknown): Parameters {
  const source = record(value, 'parameters');
  if (Object.keys(source).length !== parameterKeys.length || Object.keys(source).some(key => !parameterKeys.includes(key as ParameterKey))) fail('unknown or missing parameter.');
  return Object.fromEntries(PARAMETER_DEFINITIONS.map(def => [def.key, number(source[def.key], def.label, def.min, def.max)])) as Parameters;
}
/** Explicit v14 compatibility boundary. Validate the complete old vector;
 * never conceal a malformed recipe by normalizing or filling arbitrary keys. */
export function upgradeParameterVector(value: unknown): Parameters {
  const source = record(value, 'parameters');
  const added = ['ideaDensity', 'ensembleSize'];
  const oldKeys = parameterKeys.filter(key => !added.includes(key));
  if (Object.keys(source).length === oldKeys.length && oldKeys.every(key => key in source)
    && Object.keys(source).every(key => oldKeys.includes(key as ParameterKey))) {
    return parameters({ ...source, ...Object.fromEntries(PARAMETER_DEFINITIONS
      .filter(def => added.includes(def.key)).map(def => [def.key, def.default])) });
  }
  return parameters(source);
}
function weights(value: unknown): ScoreWeights {
  const source = record(value, 'weights');
  if (Object.keys(source).length !== scoreKeys.length || Object.keys(source).some(key => !scoreKeys.includes(key as keyof ScoreWeights))) fail('unknown or missing scoring weight.');
  return Object.fromEntries(scoreKeys.map(key => [key, number(source[key], `weight ${key}`, 0, 8)])) as ScoreWeights;
}
function sound(value: unknown): SoundConfig {
  const source = record(value, 'sound');
  if (typeof source.tuning !== 'string' || !Object.hasOwn(TUNINGS, source.tuning)) fail('unsupported tuning.');
  if (source.instrument !== 'ensemble' && source.instrument !== 'additive') fail('unsupported instrument.');
  const spectrum = record(source.spectrum, 'spectrum');
  const partials = array(spectrum.partials, 'spectrum partials', 5);
  if (partials.length !== 5) fail('spectrum requires exactly five partials.');
  let previousRatio = 0;
  const validatedPartials = partials.map((item, index) => {
    const partial = record(item, 'spectrum partial');
    const ratio = number(partial.ratio, 'partial frequency ratio', 1, 16);
    const amplitude = number(partial.amplitude, 'partial amplitude', 0, 1);
    if (ratio <= previousRatio || (index === 0 && ratio !== 1)) fail('partial ratios must begin at one and increase strictly.');
    if (amplitude === 0) fail('partial amplitudes must be positive.');
    previousRatio = ratio;
    return { ratio, amplitude };
  });
  return {
    tuning: source.tuning as SoundConfig['tuning'], instrument: source.instrument as SoundConfig['instrument'],
    spectrum: { id: string(spectrum.id, 'spectrum ID', 128), name: string(spectrum.name, 'spectrum name', 96), partials: validatedPartials },
    roughnessWeight: number(source.roughnessWeight, 'roughness weight', 0, 3),
    roughnessTarget: number(source.roughnessTarget, 'roughness target', 0, 1),
  };
}
function conductor(value: unknown): ConductorConfig {
  if (value === undefined) return { ...MANUAL_CONDUCTOR };
  const source = record(value, 'conductor');
  if (typeof source.enabled !== 'boolean' || typeof source.tuningTravel !== 'boolean') fail('conductor switches must be boolean.');
  return { enabled: source.enabled as boolean, tuningTravel: source.tuningTravel as boolean,
    amount: number(source.amount, 'autonomy', 0, 1), pace: number(source.pace, 'form pace', 0, 1) };
}
function automation(value: unknown): AutomationLane[] {
  let total = 0;
  const used = new Set<ParameterKey>();
  const lanes = array(value, 'automation', parameterKeys.length).map(item => {
    const lane = record(item, 'automation lane');
    const key = lane.parameter as ParameterKey;
    const definition = PARAMETER_DEFINITIONS.find(def => def.key === key);
    if (!definition) fail('unrecognized automation parameter.');
    if (used.has(key)) fail(`duplicate automation lane ${key}.`);
    used.add(key);
    let previous = -1;
    const points = array(lane.points, 'automation points', MAX_POINTS).map(item => {
      const point = record(item, 'automation point');
      const tick = number(point.tick, 'automation tick', 0, MAX_TICK, true);
      if (tick <= previous) fail('automation points must have unique ticks in ascending order.');
      previous = tick;
      if (point.curve !== undefined && point.curve !== 'linear' && point.curve !== 'smooth' && point.curve !== 'step') fail('unknown automation curve.');
      const result: AutomationPoint = { tick, value: number(point.value, `automation ${key}`, definition!.min, definition!.max) };
      if (point.curve !== undefined) result.curve = point.curve as AutomationPoint['curve'];
      if (point.rampEnd !== undefined) {
        const endpoint = record(point.rampEnd, 'ramp endpoint');
        result.rampEnd = {
          tick: number(endpoint.tick, 'ramp endpoint tick', 0, MAX_TICK, true),
          value: number(endpoint.value, 'ramp endpoint value', definition!.min, definition!.max),
        };
        if (result.rampEnd.tick <= tick || result.curve === 'step') fail('ramp endpoint must follow a non-step point.');
      }
      total++;
      if (total > MAX_POINTS) fail('too many automation points.');
      return result;
    });
    points.forEach((point, index) => {
      if (point.rampEnd && (!points[index + 1] || point.rampEnd.tick < points[index + 1].tick)) fail('ramp endpoint must reach the following point.');
    });
    return { parameter: key, points };
  });
  return lanes.sort((a, b) => parameterKeys.indexOf(a.parameter) - parameterKeys.indexOf(b.parameter));
}
function bookmarks(value: unknown): Bookmark[] {
  const ids = new Set<string>();
  return array(value, 'bookmarks', 256).map(item => {
    const source = record(item, 'bookmark');
    const id = string(source.id, 'bookmark ID', 128);
    if (ids.has(id)) fail('duplicate bookmark ID.');
    ids.add(id);
    return { id, name: string(source.name, 'bookmark name', 128), tick: number(source.tick, 'bookmark tick', 0, MAX_TICK, true) };
  });
}
function revisions(value: unknown): AutomationRevision[] {
  let previous = -1, totalPoints = 0;
  return array(value, 'automation revisions', 2048).map((item, index) => {
    const source = record(item, 'automation revision');
    const tick = number(source.tick, 'automation revision tick', 0, MAX_TICK, true);
    if (tick <= previous || (index === 0 && tick !== 0)) fail('automation revisions must begin at zero with unique ascending ticks.');
    previous = tick;
    const lanes = automation(source.lanes);
    totalPoints += lanes.reduce((count, lane) => count + lane.points.length, 0);
    if (totalPoints > 200_000) fail('automation revision history is too large.');
    return { tick, lanes };
  });
}
function validatePerformance(value: unknown): Performance {
  const source = record(value, 'document');
  if (source.format !== 'continuum-performance') fail('not a Continuum performance.');
  if (source.engineVersion !== ENGINE_VERSION) fail(`unsupported engine version. This instrument uses ${ENGINE_VERSION}.`);
  const result: Performance = {
    format: 'continuum-performance', engineVersion: ENGINE_VERSION,
    seed: string(source.seed, 'seed'), presetId: string(source.presetId, 'preset ID', 128),
    initialParameters: parameters(source.initialParameters), automation: automation(source.automation),
    weights: weights(source.weights), bookmarks: bookmarks(source.bookmarks), sound: sound(source.sound), conductor: conductor(source.conductor), phrasing: validatePhrasing(source.phrasing),
  };
  if (source.automationRevisions !== undefined) {
    const history = revisions(source.automationRevisions);
    if (history.length && JSON.stringify(history.at(-1)!.lanes) !== JSON.stringify(result.automation)) fail('latest automation revision must match the displayed automation.');
    if (history.length) result.automationRevisions = history;
  }
  Object.assign(result, resolveCompositionProfile(result));
  return result;
}
function validatePreset(value: unknown): Preset {
  const source = record(value, 'preset');
  const color = string(source.color, 'preset color', 9);
  if (!/^#[0-9a-f]{6}$/i.test(color)) fail('preset color must be a six-digit hex color.');
  return {
    id: string(source.id, 'preset ID', 128), name: string(source.name, 'preset name', 96),
    description: string(source.description, 'preset description', 512), color,
    parameters: upgradeParameterVector(source.parameters), custom: true,
  };
}

export function createPerformance(seed: string, preset: Preset = PRESETS[0]): Performance {
  return validatePerformance({ format: 'continuum-performance', engineVersion: ENGINE_VERSION, seed, presetId: preset.id, initialParameters: preset.parameters, automation: [], weights: DEFAULT_WEIGHTS, bookmarks: [], sound: DEFAULT_SOUND, conductor: DEFAULT_CONDUCTOR, phrasing: DEFAULT_PHRASING });
}
export function serializePerformance(performance: Performance): string {
  const result = JSON.stringify(validatePerformance(performance), null, 2);
  if (result.length > MAX_JSON_LENGTH) fail('document is too large.');
  return result;
}
export function parsePerformance(json: string): Performance {
  if (typeof json !== 'string' || json.length > MAX_JSON_LENGTH) fail('document is too large.');
  let value: unknown;
  try { value = JSON.parse(json); } catch { fail('document is not valid JSON.'); }
  return validatePerformance(value);
}
export function encodeShareState(performance: Performance): string {
  const bytes = new TextEncoder().encode(JSON.stringify(validatePerformance(performance)));
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return '#p=' + btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function decodeShareState(hash: string): Performance | null {
  try {
    if (typeof hash !== 'string' || hash.length > MAX_JSON_LENGTH * 2) return null;
    const payload = new URLSearchParams(hash.replace(/^#/, '')).get('p');
    if (!payload || !/^[A-Za-z0-9_-]+$/.test(payload)) return null;
    const binary = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
    return parsePerformance(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch { return null; }
}
export function savePresets(presets: Preset[]): void {
  const result = array(presets, 'presets', 100).map(validatePreset);
  const ids = new Set(result.map(preset => preset.id));
  if (ids.size !== result.length) fail('duplicate preset ID.');
  // Storage failures (quota or privacy settings) reach the caller so the UI can offer JSON export.
  localStorage.setItem(STORAGE_KEY, JSON.stringify(result));
}
export function loadPresets(): Preset[] {
  try {
    const source = localStorage.getItem(STORAGE_KEY);
    if (!source || source.length > MAX_JSON_LENGTH) return [];
    const presets = array(JSON.parse(source), 'presets', 100).map(validatePreset);
    return presets.filter((preset, index) => presets.findIndex(other => other.id === preset.id) === index);
  } catch { return []; }
}
export function addAutomationPoint(lanes: AutomationLane[], key: ParameterKey, tick: number, value: number, curve: AutomationPoint['curve'] = 'linear'): AutomationLane[] {
  const definition = PARAMETER_DEFINITIONS.find(def => def.key === key);
  if (!definition) fail('unrecognized automation parameter.');
  number(tick, 'automation tick', 0, MAX_TICK, true);
  number(value, 'automation value', definition!.min, definition!.max);
  if (curve !== 'linear' && curve !== 'smooth' && curve !== 'step') fail('unknown automation curve.');
  const result = lanes.map(lane => ({ parameter: lane.parameter, points: lane.points.map(point => ({ ...point })) }));
  let lane = result.find(lane => lane.parameter === key);
  if (!lane) { lane = { parameter: key, points: [] }; result.push(lane); }
  lane.points = [...lane.points.filter(point => point.tick !== tick), { tick, value, curve }].sort((a, b) => a.tick - b.tick);
  return automation(result);
}

/** Keep the exact original interpolation expression at every tick before a new point. */
function preserveIncomingSegment(lane: AutomationLane, tick: number): AutomationLane {
  const points = lane.points.map(point => ({ ...point, ...(point.rampEnd ? { rampEnd: { ...point.rampEnd } } : {}) }));
  let index = -1;
  while (index + 1 < points.length && points[index + 1].tick < tick) index++;
  const previous = points[index], next = points[index + 1];
  if (previous && previous.curve !== 'step') {
    if (next) previous.rampEnd ??= { tick: next.tick, value: next.value };
    else { previous.curve = 'step'; delete previous.rampEnd; }
  }
  return { parameter: lane.parameter, points };
}

/** Preserve what the planner knew at each boundary, including its future horizon. */
function recordRevision(result: Performance, previousLanes: AutomationLane[], knownAtTick: number): Performance {
  if (knownAtTick === 0) { delete result.automationRevisions; return result; }
  const history = result.automationRevisions ?? [{ tick: 0, lanes: automation(previousLanes) }];
  result.automationRevisions = revisions([
    ...history.filter(revision => revision.tick < knownAtTick),
    { tick: knownAtTick, lanes: automation(result.automation) },
  ]);
  return result;
}

/** Record a live edit without rewriting any previously evaluated parameter values. */
export function recordLiveParameters(performance: Performance, changes: Partial<Parameters>, tick: number): Performance {
  const result = validatePerformance(performance);
  const previousLanes = result.automation;
  number(tick, 'edit tick', 0, MAX_TICK, true);
  for (const [key, value] of Object.entries(record(changes, 'parameter changes'))) {
    const definition = PARAMETER_DEFINITIONS.find(def => def.key === key);
    if (!definition) fail('unrecognized parameter change.');
    number(value, 'parameter change', definition!.min, definition!.max);
    const lane = result.automation.find(lane => lane.parameter === key);
    if (lane) result.automation = result.automation.map(item => item === lane ? preserveIncomingSegment(item, tick) : item);
    result.automation = addAutomationPoint(result.automation, key as ParameterKey, tick, value as number, 'step');
  }
  return recordRevision(result, previousLanes, tick);
}

/** Replace a future interval with a transition, preserving the exact trajectory before its start. */
export function scheduleParameterTransition(performance: Performance, key: ParameterKey, startTick: number, endTick: number, value: number, curve: AutomationPoint['curve'] = 'linear', knownAtTick = 0): Performance {
  const result = validatePerformance(performance);
  const previousLanes = result.automation;
  const definition = PARAMETER_DEFINITIONS.find(def => def.key === key);
  if (!definition) fail('unrecognized transition parameter.');
  number(startTick, 'transition start', 0, MAX_TICK, true);
  number(endTick, 'transition end', 0, MAX_TICK, true);
  number(knownAtTick, 'transition recording tick', 0, MAX_TICK, true);
  number(value, 'transition value', definition!.min, definition!.max);
  if (endTick <= startTick) fail('transition end must follow its start.');
  if (startTick < knownAtTick) fail('transition cannot begin before it was recorded.');
  if (curve !== 'linear' && curve !== 'smooth' && curve !== 'step') fail('unknown transition curve.');
  const initial = new ScoreTimeline({ ...result, parameters: result.initialParameters }).at(startTick).parameters[key];
  const existing = result.automation.find(lane => lane.parameter === key);
  const lane = preserveIncomingSegment(existing ?? { parameter: key, points: [] }, startTick);
  lane.points = [
    ...lane.points.filter(point => point.tick < startTick),
    { tick: startTick, value: initial, curve },
    { tick: endTick, value, curve: 'step' },
    ...lane.points.filter(point => point.tick > endTick),
  ];
  result.automation = automation([...result.automation.filter(item => item.parameter !== key), lane]);
  return recordRevision(result, previousLanes, knownAtTick);
}
