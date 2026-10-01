import { MusicEngine, eventHash } from './engine';
import { DEFAULT_PARAMETERS, DEFAULT_WEIGHTS } from './parameters';
import { DEFAULT_SOUND, SPECTRA, type SoundConfig } from './spectrum';
import { ENGINE_VERSION, type NoteEvent, type Parameters } from './types';
import { lyricalPerformance } from './lyrical';
import { createPerformance } from './serialization';
import { DEFAULT_CONDUCTOR, type ConductorConfig } from './conductor';
import { DEFAULT_PHRASING, type PhraseConfig } from './phrasing';

/** Fixed input and committed event hashes. Do not regenerate these at audit time.
 * Review intentional musical changes and engine compatibility before updating.
 * scripts/print-conformance.ts prints candidate replacements without editing this file.
 */
export const CONFORMANCE_VERSION = 'continuum-20.0.0';
export const CONFORMANCE_REFERENCE_RUNTIME = 'Node 24.14.0 / V8 13.6.233.17-node.41 / Windows x64';
export const CONFORMANCE_SEED = 'glass-garden';
export const CONFORMANCE_FRAMES = 32;

interface ConformanceFixture { id: string; sound: SoundConfig; expected: string; conductor?: ConductorConfig; phrasing?: PhraseConfig; frames?: number; parameters?: Parameters; }
const lyrical = lyricalPerformance(createPerformance(CONFORMANCE_SEED)).recipe;
const oldLyrical = structuredClone(lyrical.phrasing!);
delete oldLyrical.harmony;
const fixtures: ConformanceFixture[] = [
  { id: '12tet-ensemble', sound: { ...DEFAULT_SOUND, spectrum: SPECTRA[0], roughnessWeight: 0 }, expected: 'fe9a9e7b' },
  { id: '12tet-additive-harmonic', sound: { ...DEFAULT_SOUND, instrument: 'additive', spectrum: SPECTRA[0], roughnessWeight: 1 }, expected: 'c9e5f594' },
  { id: '19edo-additive-harmonic', sound: { ...DEFAULT_SOUND, tuning: '19edo', instrument: 'additive', spectrum: SPECTRA[0], roughnessWeight: 1 }, expected: '34c710b7' },
  { id: '19edo-additive-stretched', sound: { ...DEFAULT_SOUND, tuning: '19edo', instrument: 'additive', spectrum: SPECTRA[1], roughnessWeight: 1 }, expected: 'ca9c1b88' },
  { id: '24edo-ensemble', sound: { ...DEFAULT_SOUND, tuning: '24edo' }, expected: 'f6bfcf63' },
  { id: '24edo-additive-harmonic', sound: { ...DEFAULT_SOUND, tuning: '24edo', instrument: 'additive', roughnessWeight: 1 }, expected: 'cbcc40f8' },
  { id: '31edo-ensemble', sound: { ...DEFAULT_SOUND, tuning: '31edo' }, expected: '31b3253a' },
  { id: '31edo-additive-harmonic', sound: { ...DEFAULT_SOUND, tuning: '31edo', instrument: 'additive', roughnessWeight: 1 }, expected: '9efc9ea7' },
  { id: 'autonomous-ensemble', sound: { ...DEFAULT_SOUND }, conductor: { ...DEFAULT_CONDUCTOR }, frames: 128, expected: '660ee302' },
  { id: 'autonomous-additive', sound: { ...DEFAULT_SOUND, instrument: 'additive', roughnessWeight: 1 }, conductor: { ...DEFAULT_CONDUCTOR }, frames: 128, expected: '3788781b' },
  { id: 'phrased-ensemble', sound: { ...DEFAULT_SOUND }, conductor: { ...DEFAULT_CONDUCTOR }, phrasing: { ...DEFAULT_PHRASING }, frames: 192, expected: '5cb31690' },
  { id: 'phrased-additive', sound: { ...DEFAULT_SOUND, instrument: 'additive', roughnessWeight: 1 }, conductor: { ...DEFAULT_CONDUCTOR }, phrasing: { ...DEFAULT_PHRASING }, frames: 192, expected: 'd3074b26' },
  { id: 'lyrical-12tet', sound: { ...DEFAULT_SOUND }, parameters: lyrical.initialParameters, conductor: lyrical.conductor, phrasing: oldLyrical, frames: 128, expected: '88a86dbd' },
  { id: 'lyrical-19edo', sound: { ...DEFAULT_SOUND, tuning: '19edo', instrument: 'additive', roughnessWeight: 1 }, parameters: lyrical.initialParameters, conductor: lyrical.conductor, phrasing: oldLyrical, frames: 128, expected: '6d083b7d' },
  { id: 'thematic-12tet', sound: { ...DEFAULT_SOUND }, parameters: lyrical.initialParameters, conductor: lyrical.conductor, phrasing: lyrical.phrasing, frames: 128, expected: '88a86dbd' },
  { id: 'thematic-19edo', sound: { ...DEFAULT_SOUND, tuning: '19edo', instrument: 'additive', roughnessWeight: 1 }, parameters: lyrical.initialParameters, conductor: lyrical.conductor, phrasing: lyrical.phrasing, frames: 128, expected: '6d083b7d' },
];

export interface ConformanceCase { id: string; frames: number; expected: string; actual: string; passed: boolean; }
export interface ConformanceReport {
  engineVersion: string;
  fixtureVersion: string;
  referenceRuntime: string;
  seed: string;
  frames: number;
  cases: ConformanceCase[];
  passed: boolean;
}

export interface ConformanceProgress {
  id: string;
  /** Zero-based fixture index; completed frames refer to this fixture. */
  caseIndex: number;
  caseCount: number;
  framesCompleted: number;
  framesTotal: number;
}

function fixtureEngine(fixture: ConformanceFixture): MusicEngine {
  return new MusicEngine({
    seed: CONFORMANCE_SEED,
    parameters: { ...(fixture.parameters ?? DEFAULT_PARAMETERS) },
    weights: { ...DEFAULT_WEIGHTS },
    sound: structuredClone(fixture.sound),
    conductor: fixture.conductor,
    phrasing: fixture.phrasing,
  });
}

function fixtureResult(fixture: ConformanceFixture, notes: NoteEvent[]): ConformanceCase {
  const actual = eventHash(notes);
  return { id: fixture.id, frames: fixture.frames ?? CONFORMANCE_FRAMES, expected: fixture.expected, actual,
    passed: ENGINE_VERSION === CONFORMANCE_VERSION && actual === fixture.expected };
}

function conformanceReport(cases: ConformanceCase[]): ConformanceReport {
  return { engineVersion: ENGINE_VERSION, fixtureVersion: CONFORMANCE_VERSION, referenceRuntime: CONFORMANCE_REFERENCE_RUNTIME,
    seed: CONFORMANCE_SEED, frames: CONFORMANCE_FRAMES, cases, passed: cases.every(result => result.passed) };
}

/** Runs without Web Audio or browser APIs, in either Node or a browser.
 * Only musical events are compared; diagnostics and audio waveforms are excluded.
 */
export function runConformance(): ConformanceReport {
  const cases = fixtures.map(fixture => {
    const engine = fixtureEngine(fixture);
    const notes = Array.from({ length: fixture.frames ?? CONFORMANCE_FRAMES }, () => engine.step()).flatMap(frame => frame.notes);
    return fixtureResult(fixture, notes);
  });
  return conformanceReport(cases);
}

/** The same fixed fixture construction and event hashing as the synchronous
 * Node check, with a real task-queue yield after every eight committed frames.
 * A microtask alone would not let the browser paint progress or handle input.
 * Generation order, musical ticks and expected hashes remain unchanged. */
export async function runConformanceAsync(options: {
  onProgress?: (progress: ConformanceProgress) => void;
} = {}): Promise<ConformanceReport> {
  const cases: ConformanceCase[] = [];
  const yieldBrowser = () => new Promise<void>(resolve => setTimeout(resolve, 0));
  for (let caseIndex = 0; caseIndex < fixtures.length; caseIndex++) {
    const fixture = fixtures[caseIndex], framesTotal = fixture.frames ?? CONFORMANCE_FRAMES;
    const progress = (framesCompleted: number) => options.onProgress?.({ id: fixture.id, caseIndex,
      caseCount: fixtures.length, framesCompleted, framesTotal });
    progress(0); await yieldBrowser();
    const engine = fixtureEngine(fixture), notes: NoteEvent[] = [];
    for (let index = 0; index < framesTotal; index++) {
      notes.push(...engine.step().notes);
      if ((index + 1) % 8 === 0 || index + 1 === framesTotal) {
        progress(index + 1); await yieldBrowser();
      }
    }
    cases.push(fixtureResult(fixture, notes));
  }
  return conformanceReport(cases);
}
