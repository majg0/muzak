import type { Pitch } from "./pitch";
import type { SoundConfig } from "./spectrum";
import type { ConductorConfig, FormState, InstrumentColor } from "./conductor";
import type { PhraseConfig, PhraseSnapshot } from "./phrasing";
import type { HarmonicDestination, harmonicRealization } from "./engine/harmonic-tools";
export const ENGINE_VERSION = "continuum-20.0.0";
export const PPQ = 480;
export const FRAME_TICKS = 960;
export type ParameterKey =
  | "tension"
  | "harmonicMobility"
  | "harmonicSurprise"
  | "voiceLeading"
  | "tonalClarity"
  | "tonalGravity"
  | "dissonance"
  | "brightness"
  | "chromaticism"
  | "intervalComplexity"
  | "quartalTendency"
  | "bassIndependence"
  | "bassMobility"
  | "melodicActivity"
  | "ideaDensity"
  | "ensembleSize"
  | "melodicFamiliarity"
  | "motifRecurrence"
  | "motifTransformation"
  | "rhythmicComplexity"
  | "rhythmicPredictability"
  | "rhythmicDensity"
  | "metricStability"
  | "texturalDensity"
  | "dynamics"
  | "tempo";
export type Parameters = Record<ParameterKey, number>;
export interface ParameterDefinition {
  key: ParameterKey;
  label: string;
  description: string;
  group: "Harmony" | "Motion" | "Melody" | "Rhythm" | "Texture";
  min: number;
  max: number;
  default: number;
  interpolation?: "linear" | "smooth" | "log";
}
export interface Preset {
  id: string;
  name: string;
  description: string;
  color: string;
  parameters: Parameters;
  custom?: boolean;
}
export interface AutomationPoint {
  tick: number;
  value: number;
  curve?: "linear" | "smooth" | "step";
  rampEnd?: { tick: number; value: number };
}
export interface AutomationLane {
  parameter: ParameterKey;
  points: AutomationPoint[];
}
export interface AutomationRevision {
  tick: number;
  lanes: AutomationLane[];
}
export type ScoreKey =
  | "smoothness"
  | "commonTones"
  | "harmonicMotion"
  | "tonalGravity"
  | "dissonance"
  | "tension"
  | "independence"
  | "novelty"
  | "structure";
export type ScoreWeights = Record<ScoreKey, number>;
export interface NoteEvent {
  id: string;
  tick: number;
  duration: number;
  absolutePitch?: Pitch;
  /** Physical start pitch is absolutePitch; glide reaches endPitch after glideTicks. */
  endPitch?: Pitch;
  glideTicks?: number;
  timbre?: InstrumentColor;
  /** Ensemble attack/sustain intent, independent of pitch, timbre and velocity.
   * The matched additive rack retains its fixed spectral reference envelope. */
  articulation?: "sustained" | "connected" | "detached";
  /** Integer MIDI adapter, or GM drum key for percussion. Omitted for microtonal pitches. */ midiNote?: number;
  velocity: number;
  /** Musical-time amplitude contour; ticks are offsets from note onset, strictly
   * increasing within [0,duration], gains in [0,1]. Linear, held at endpoints.
   * Ensemble synthesis multiplies this by velocity; fixed-spectrum additive ignores it. */
  gainEnvelope?: Array<{ tick: number; gain: number }>;
  /** Auditable relationship to the shared score; never interpreted as pitch. */
  expression?: {
    role: "anchor" | "ornament" | "support" | "layer";
    sourceId?: string;
    cueId?: string;
  };
  part: "harmony" | "bass" | "melody" | "percussion";
  voice: number;
}
export interface Motif {
  id: string;
  name: string;
  intervals: number[];
  intervalUnit: `${import('./pitch').TuningId}-degrees`;
  rhythm: number[];
  /** Frame index, not a tick. */ born: number;
  lastRecalled: number;
  salience: number;
  level: "cell" | "phrase" | "theme";
  recalls: number;
}
export interface TensionComponents {
  harmonic: number;
  ambiguity: number;
  rhythmic: number;
  register: number;
  density: number;
  instability: number;
  cadential: number;
}
export interface FrameDiagnostics {
  /** Actual arrangement contract, separate from score energy and loudness. */
  arrangement?: { name: string; size: number; voices: number[]; colors: InstrumentColor[] };
  /** One shared expressive reading, consumed by every orchestral part. */
  compositionExpression?: import('./engine/expression').ExpressiveContour & import('./engine/texture').TextureIntent;
  /** Declared harmonic purpose and the measured realization are distinct. */
  harmonicPlan?: {
    routeId: string;
    current: HarmonicDestination;
    destinations: HarmonicDestination[];
    realization: ReturnType<typeof harmonicRealization>;
    tools?: readonly string[];
    coverage?: import('./engine/idea-selection').ToolCoverage;
    evaluation?: Readonly<Record<string, number>>;
    candidatesEvaluated?: number;
  };
  /** Candidate-controlled harmonic goals; independent of orchestral energy
   * and of the spectral sensory-roughness experiment. */
  harmonicTension?: HarmonicTensionDiagnostics;
  /** Four-quarter-note window measured from committed events, excluding FX.
   * Requested energy is an intention; counts and velocity are observations. */
  orchestration?: OrchestrationDiagnostics;
  /** 12-TET conventional tonal center only. */ tonalCenter?: number;
  /** Alternative tuning's explicit degree of attraction. */ tonalCenterDegree?: number;
  clarity: number;
  voiceLeadingCents: number;
  harmonicDistance: number;
  dissonance: number;
  actualTension: number;
  targetTension: number;
  tension: TensionComponents;
  scores: Record<ScoreKey, number>;
  totalScore: number;
  candidatesEvaluated: number;
  horizon: number;
  sensoryRoughness?: number;
  roughnessTarget?: number;
  roughnessContribution?: number;
  /** Musical fit to important foreground tones; independent of roughness. */
  melodicSupport?: number;
  recall?: { motifId: string; transformation: string };
  section: number;
  phrase: number;
}
export interface HarmonicTensionDiagnostics {
  actual: number;
  target: number;
  components: Record<'friction' | 'ambiguity' | 'motion', { actual: number; target: number }>;
}
export interface OrchestrationDiagnostics {
  requestedEnergy: number;
  attacksPerBeat: number;
  activeVoices: number;
  meanVelocity: number;
  heldGainProxy: number;
}
export interface Frame {
  index: number;
  tick: number;
  duration: number;
  voicePitches: Pitch[];
  bassPitch: Pitch;
  sound: SoundConfig;
  notes: NoteEvent[];
  diagnostics: FrameDiagnostics;
  parameters: Parameters;
  motifs: Motif[];
  form?: FormState;
  phrase?: PhraseSnapshot;
}
export interface Bookmark {
  id: string;
  name: string;
  tick: number;
}
export interface Performance {
  format: "continuum-performance";
  engineVersion: string;
  seed: string;
  presetId: string;
  initialParameters: Parameters;
  automation: AutomationLane[];
  automationRevisions?: AutomationRevision[];
  weights: ScoreWeights;
  bookmarks: Bookmark[];
  sound: SoundConfig;
  conductor?: ConductorConfig;
  phrasing?: PhraseConfig;
}
export interface EngineConfig {
  seed: string;
  parameters: Parameters;
  automation?: AutomationLane[];
  automationRevisions?: AutomationRevision[];
  weights?: Partial<ScoreWeights>;
  sound?: SoundConfig;
  conductor?: ConductorConfig;
  phrasing?: PhraseConfig;
}
