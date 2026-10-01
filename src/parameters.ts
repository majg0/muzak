import type { AutomationLane, ParameterDefinition, ParameterKey, Parameters, Preset, ScoreWeights } from './types';

export const PARAMETER_DEFINITIONS: ParameterDefinition[] = [
  { key: 'tension', label: 'Tension', description: 'The emotional intensity around which phrase and section arcs rise and fall.', group: 'Harmony', min: 0, max: 1, default: .38 },
  { key: 'harmonicMobility', label: 'Harmonic mobility', description: 'How far the pitch collection travels while the individual voices stay connected.', group: 'Harmony', min: 0, max: 1, default: .66 },
  { key: 'harmonicSurprise', label: 'Harmonic surprise', description: 'Favor less expected destinations within the current musical trajectory.', group: 'Harmony', min: 0, max: 1, default: .36 },
  { key: 'voiceLeading', label: 'Voice-leading smoothness', description: 'Connect the harmonic voices with small pitch steps and held common tones. The foreground melody has its own interval gestures.', group: 'Motion', min: 0, max: 1, default: .91 },
  { key: 'tonalClarity', label: 'Tonal clarity', description: 'How clearly a stable pitch collection and tonal center can be heard.', group: 'Harmony', min: 0, max: 1, default: .52 },
  { key: 'tonalGravity', label: 'Tonal gravity', description: 'The pull toward the current tonal center, even as that center migrates.', group: 'Harmony', min: 0, max: 1, default: .56 },
  { key: 'dissonance', label: 'Dissonance', description: 'Permit closer, more frictional intervals within the texture.', group: 'Harmony', min: 0, max: 1, default: .28 },
  { key: 'brightness', label: 'Brightness', description: 'Open the sound and favor a lighter register.', group: 'Texture', min: 0, max: 1, default: .56 },
  { key: 'chromaticism', label: 'Chromaticism', description: 'Permit pitches outside the current tonal field as stepping stones and destinations.', group: 'Harmony', min: 0, max: 1, default: .40 },
  { key: 'intervalComplexity', label: 'Interval complexity', description: 'Broaden melodic transfers and register gestures while adding harmonic interval color. Familiarity keeps the identifying subject recognizable.', group: 'Harmony', min: 0, max: 1, default: .58 },
  { key: 'quartalTendency', label: 'Quartal tendency', description: 'Encourage fourths and fifths as organizing intervals.', group: 'Harmony', min: 0, max: 1, default: .36 },
  { key: 'bassIndependence', label: 'Bass independence', description: 'Let the bass reinterpret a sustained upper structure.', group: 'Motion', min: 0, max: 1, default: .60 },
  { key: 'bassMobility', label: 'Bass mobility', description: 'How freely the bass moves between registers and harmonic destinations.', group: 'Motion', min: 0, max: 1, default: .42 },
  { key: 'melodicActivity', label: 'Melodic activity', description: 'Invite thematic answers and more active surface delivery while preserving the core rhythm.', group: 'Melody', min: 0, max: 1, default: .35 },
  { key: 'ideaDensity', label: 'Idea density', description: 'From spacious complete thoughts to compact subjects, sequences and rapid developed gestures. Changes take effect at the next authored thought.', group: 'Melody', min: 0, max: 1, default: .5 },
  { key: 'ensembleSize', label: 'Ensemble size', description: 'From one exposed melodic voice through chamber groups to a broad, layered ensemble. Independent of playing speed and loudness.', group: 'Texture', min: 0, max: 1, default: .55 },
  { key: 'melodicFamiliarity', label: 'Melodic familiarity', description: 'Keep developed continuations close to remembered steps and contour. Applies when the next thought is composed.', group: 'Melody', min: 0, max: 1, default: .66 },
  { key: 'motifRecurrence', label: 'Motif recurrence', description: 'Favor a literal source return when an already-heard theme returns. Its identifying head remains recognizable.', group: 'Melody', min: 0, max: 1, default: .57 },
  { key: 'motifTransformation', label: 'Motif transformation', description: 'Increase continuation changes, register freedom and decorative links in developed returns. Fixed-melody and sequence treatments keep their declared identities.', group: 'Melody', min: 0, max: 1, default: .48 },
  { key: 'rhythmicComplexity', label: 'Rhythmic complexity', description: 'Introduce syncopation and varied rhythmic cells.', group: 'Rhythm', min: 0, max: 1, default: .31 },
  { key: 'rhythmicPredictability', label: 'Rhythmic predictability', description: 'Keep a recognizable rhythmic identity from phrase to phrase.', group: 'Rhythm', min: 0, max: 1, default: .73 },
  { key: 'rhythmicDensity', label: 'Rhythmic density', description: 'How often the percussion punctuates the music.', group: 'Rhythm', min: 0, max: 1, default: .15 },
  { key: 'metricStability', label: 'Metric stability', description: 'Emphasize the pulse and strong beats.', group: 'Rhythm', min: 0, max: 1, default: .80 },
  { key: 'texturalDensity', label: 'Textural density', description: 'Control the fullness and overlap of the instrumental texture.', group: 'Texture', min: 0, max: 1, default: .58 },
  { key: 'dynamics', label: 'Dynamics', description: 'The performance intensity of the instruments.', group: 'Texture', min: 0, max: 1, default: .57 },
  { key: 'tempo', label: 'Tempo', description: 'Musical beats per minute; tempo changes preserve musical time.', group: 'Rhythm', min: 40, max: 180, default: 88, interpolation: 'log' },
];

export const DEFAULT_PARAMETERS: Parameters = Object.fromEntries(PARAMETER_DEFINITIONS.map(p => [p.key, p.default])) as Parameters;
export const DEFAULT_WEIGHTS: ScoreWeights = { smoothness: 1, commonTones: 1, harmonicMotion: 1, tonalGravity: 1, dissonance: 1, tension: 1, independence: 1, novelty: 1, structure: 1 };

const preset = (id: string, name: string, description: string, color: string, parameters: Partial<Parameters>): Preset => ({
  id, name, description, color, parameters: { ...DEFAULT_PARAMETERS, ...parameters },
});

export const PRESETS: Preset[] = [
  preset('fluid-fusion', 'Fluid Fusion', 'Warm keys, liquid voice movement, and a bass with a mind of its own.', '#a9b8ed', {}),
  preset('floating-tonality', 'Floating Tonality', 'Open intervals drift through an ambiguous, gently shifting tonal field.', '#9dd8c6', { tonalClarity: .24, tonalGravity: .28, harmonicMobility: .68, quartalTendency: .76, tension: .30, voiceLeading: .96, melodicActivity: .24, rhythmicDensity: .08, tempo: 76 }),
  preset('chromatic-drift', 'Chromatic Drift', 'Tiny steps in the voices carry the harmony surprisingly far.', '#d6a9df', { harmonicMobility: .92, harmonicSurprise: .68, voiceLeading: .99, tonalClarity: .28, tonalGravity: .32, chromaticism: .88, dissonance: .46, bassIndependence: .79, melodicActivity: .26, rhythmicDensity: .12, tension: .52, tempo: 82 }),
  preset('lydian-open', 'Lydian Open', 'Luminous, spacious voicings with suspended fourths and gentle melodic light.', '#d7d99f', { brightness: .77, quartalTendency: .64, tonalClarity: .75, tonalGravity: .69, chromaticism: .22, dissonance: .20, harmonicMobility: .45, intervalComplexity: .66, melodicActivity: .42, tension: .26, tempo: 94 }),
  preset('dense-motion', 'Dense Harmonic Motion', 'An active, layered texture moves through richly colored destinations.', '#e8b391', { harmonicMobility: .88, harmonicSurprise: .66, texturalDensity: .85, intervalComplexity: .84, tension: .68, dissonance: .53, bassIndependence: .80, bassMobility: .70, melodicActivity: .59, rhythmicComplexity: .64, rhythmicDensity: .44, tempo: 108 }),
  preset('sparse-suspended', 'Sparse Suspended', 'A quiet, slow conversation between held tones and widely spaced gestures.', '#92becd', { texturalDensity: .23, melodicActivity: .15, rhythmicDensity: 0, harmonicMobility: .28, voiceLeading: .97, quartalTendency: .66, tension: .18, dissonance: .17, dynamics: .38, brightness: .40, motifRecurrence: .73, tempo: 58 }),
  preset('tonal-lyrical', 'Tonal / Lyrical', 'Recognizable melodic ideas return within a clear, singing harmonic field.', '#ddb4b5', { tonalClarity: .92, tonalGravity: .87, chromaticism: .12, dissonance: .12, harmonicMobility: .36, harmonicSurprise: .18, bassIndependence: .26, melodicActivity: .62, melodicFamiliarity: .88, motifRecurrence: .81, motifTransformation: .25, tension: .30, tempo: 84 }),
  preset('unstable-searching', 'Unstable / Searching', 'Restless bass, altered memories, and unstable rhythmic edges seek a place to land.', '#b6a4e5', { tension: .76, harmonicMobility: .86, harmonicSurprise: .88, tonalClarity: .16, tonalGravity: .22, dissonance: .64, chromaticism: .86, bassIndependence: .94, bassMobility: .78, melodicActivity: .54, motifTransformation: .85, rhythmicComplexity: .82, rhythmicPredictability: .32, rhythmicDensity: .46, metricStability: .32, tempo: 103 }),
];

export function normalizeParameters(input: Partial<Parameters> | unknown): Parameters {
  const source = input !== null && typeof input === 'object' ? input as Partial<Parameters> : {};
  return Object.fromEntries(PARAMETER_DEFINITIONS.map(def => {
    const value = source[def.key];
    return [def.key, typeof value === 'number' && Number.isFinite(value) ? Math.max(def.min, Math.min(def.max, value)) : def.default];
  })) as Parameters;
}

export function interpolateParameters(a: Parameters, b: Parameters, alpha: number): Parameters {
  const amount = Number.isFinite(alpha) ? Math.max(0, Math.min(1, alpha)) : 0;
  const from = normalizeParameters(a), to = normalizeParameters(b);
  return Object.fromEntries(PARAMETER_DEFINITIONS.map(def => {
    const t = def.interpolation === 'smooth' ? amount * amount * (3 - 2 * amount) : amount;
    const value = t === 0 ? from[def.key] : t === 1 ? to[def.key] : def.interpolation === 'log'
      ? Math.exp(Math.log(from[def.key]) + (Math.log(to[def.key]) - Math.log(from[def.key])) * t)
      : from[def.key] + (to[def.key] - from[def.key]) * t;
    return [def.key, value];
  })) as Parameters;
}

/** A point's curve governs its outgoing segment. Before a lane starts, hold the initial value. */
export function evaluateAutomation(base: Parameters, lanes: AutomationLane[], tick: number): Parameters {
  const result = { ...base };
  for (const lane of lanes) {
    const points = lane.points;
    if (!points.length || tick < points[0].tick) continue;
    let left = 0, right = points.length - 1;
    while (left < right) {
      const middle = Math.ceil((left + right) / 2);
      if (points[middle].tick <= tick) left = middle;
      else right = middle - 1;
    }
    const start = points[left], end = points[left + 1];
    let value = start.value;
    if (end && start.curve !== 'step') {
      // An interrupted ramp keeps its original endpoint so later edits never reshape its past.
      const target = start.rampEnd ?? end;
      let amount = (tick - start.tick) / (target.tick - start.tick);
      if (start.curve === 'smooth') amount = amount * amount * (3 - 2 * amount);
      value += (target.value - start.value) * amount;
    }
    result[lane.parameter] = value;
  }
  return normalizeParameters(result);
}
