/** The composition's harmonic preferences. Every runtime profile has these;
 * musical language remains separate from tuning and sensory roughness. */
export interface HarmonyConfig {
  functionalMotion: number;
  harmonicColor: number;
  cadenceStrength: number;
  strategy: 'balanced' | 'functional' | 'tonnetz' | 'third-cycle';
  treatment: 'develop' | 'reharmonize' | 'sequence';
}

export const DEFAULT_HARMONY: HarmonyConfig = {
  functionalMotion: .68, harmonicColor: .32, cadenceStrength: .86,
  strategy: 'balanced', treatment: 'develop',
};
export const HARMONY_CONTROLS = [
  ['functionalMotion', 'Harmonic pace', 'Above 40%, allow a new harmony each aligned structural bar. Lower values give destinations more time to unfold.'],
  ['harmonicColor', 'Departure & surprise', 'In directed and functional modes, permit more common-tone excursions and secondary dominants. Dedicated Tonnetz and third-cycle modes choose their own departure rules.'],
  ['cadenceStrength', 'Cadential directness', 'Favor dominant-to-tonic endings over plagal replies when a closed melodic sentence arrives. The melody can still favor the gentler alternative.'],
] as const;
const STRATEGIES: HarmonyConfig['strategy'][] = ['balanced', 'functional', 'tonnetz', 'third-cycle'];
const TREATMENTS: HarmonyConfig['treatment'][] = ['develop', 'reharmonize', 'sequence'];
export function normalizeHarmony(input: Partial<HarmonyConfig> = {}): HarmonyConfig {
  const result = { ...DEFAULT_HARMONY };
  for (const [key] of HARMONY_CONTROLS) if (typeof input[key] === 'number' && Number.isFinite(input[key])) {
    result[key] = Math.round(Math.max(0, Math.min(1, input[key]!)) * 1e6) / 1e6;
  }
  if (STRATEGIES.includes(input.strategy!)) result.strategy = input.strategy!;
  if (TREATMENTS.includes(input.treatment!)) result.treatment = input.treatment!;
  return result;
}
export function validateHarmony(input: unknown): HarmonyConfig | undefined {
  if (input === undefined) return undefined;
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Harmonic language must be an object.');
  const value = input as Record<string, unknown>;
  const keys = ['functionalMotion', 'harmonicColor', 'cadenceStrength', 'strategy', 'treatment'];
  if (Object.keys(value).some(key => !keys.includes(key))) throw new Error('Unknown harmonic language control.');
  for (const [key] of HARMONY_CONTROLS) if (typeof value[key] !== 'number' || !Number.isFinite(value[key]) || value[key] < 0 || value[key] > 1) {
    throw new Error(`Harmonic language ${key} must be between 0 and 1.`);
  }
  if (!STRATEGIES.includes(value.strategy as HarmonyConfig['strategy'])) throw new Error('Unknown harmonic strategy.');
  if (!TREATMENTS.includes(value.treatment as HarmonyConfig['treatment'])) throw new Error('Unknown theme treatment.');
  return normalizeHarmony(value as unknown as HarmonyConfig);
}
