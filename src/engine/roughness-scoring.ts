import { type Pitch } from '../pitch';
import { roughnessForPitches } from '../roughness';
import type { SoundConfig } from '../spectrum';
import { clamp, round, triangle } from './analysis';

export interface RoughnessResult { value: number; target: number; contribution: number; }
export interface RoughnessScorer {
  applicable: boolean;
  enabled: boolean;
  evaluate(pitches: number[], frameIndex: number): RoughnessResult;
}

/** A separate sensory trajectory: small phrase waves inside a slower section
 * wave, with integer musical phase and no dependence on emotional tension. */
export function roughnessTargetAt(frameIndex: number, center: number): number {
  return round(clamp(center + (triangle(frameIndex, 16) - 0.5) * 0.1 + (triangle(frameIndex + 8, 64) - 0.5) * 0.06));
}

/** Per-instrument, bounded cache. A scorer owns an immutable copy of the complete
 * spectrum, so identical IDs with different ratios/amplitudes never alias. */
export function createRoughnessScorer(sound: SoundConfig, toPitch: (nativePitch: number) => Pitch): RoughnessScorer {
  const spectrum = structuredClone(sound.spectrum);
  const cache = new Map<string, number>();
  const applicable = sound.instrument === 'additive';
  const enabled = applicable && sound.roughnessWeight > 0;
  return {
    applicable,
    enabled,
    evaluate(nativePitches, frameIndex) {
      const pitches = nativePitches.map(toPitch).sort((a, b) => a.millicents - b.millicents);
      const key = pitches.map(pitch => pitch.millicents).join(',');
      let value = cache.get(key);
      if (value === undefined) {
        value = roughnessForPitches(pitches, spectrum);
        if (cache.size >= 4096) cache.delete(cache.keys().next().value!);
        cache.set(key, value);
      }
      const target = roughnessTargetAt(frameIndex, sound.roughnessTarget);
      return { value, target, contribution: enabled ? round(-Math.abs(value - target) * sound.roughnessWeight * 4) : 0 };
    },
  };
}
