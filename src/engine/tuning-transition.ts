import { degreeToPitch, midiToPitch, pitchToDegree, pitchToMidi, type Pitch, type TuningId } from '../pitch';
import { BASS_RANGE, clamp, VOICE_RANGES } from './analysis';
import { nativeSpace } from './native-space';

export const absoluteFromNative = (native: number, tuning: TuningId): Pitch => tuning !== '12tet' ? degreeToPitch(tuning, native) : midiToPitch(native);

/** Project a voiced physical sonority to a new native grid, correcting only
 * rounding collisions. The following planner continues from this state. */
export function projectSonority(upper: Pitch[], bassPitch: Pitch, target: TuningId): { upper: number[]; bass: number } {
  const convert = (pitch: Pitch) => target !== '12tet' ? pitchToDegree(target, pitch) : Math.round(pitchToMidi(pitch));
  const space = target === '12tet' ? undefined : nativeSpace(target);
  const ranges = space?.voices ?? VOICE_RANGES;
  const gap = space?.minimumGap ?? 2, maximumGap = space?.maximumGap ?? 14, span = space?.span ?? 31;
  const result = upper.map((pitch, i) => clamp(convert(pitch), ranges[i][0], ranges[i][1]));
  for (let pass = 0; pass < 4; pass++) {
    for (let i = 1; i < result.length; i++) result[i] = clamp(clamp(result[i], result[i - 1] + gap, result[i - 1] + maximumGap), ranges[i][0], ranges[i][1]);
    for (let i = result.length - 2; i >= 0; i--) result[i] = clamp(clamp(result[i], result[i + 1] - maximumGap, result[i + 1] - gap), ranges[i][0], ranges[i][1]);
    result[0] = Math.max(result[0], result[3] - span);
  }
  const bassRange = space?.bass ?? BASS_RANGE;
  const bass = clamp(convert(bassPitch), bassRange[0], Math.min(bassRange[1], result[0] - (space?.bassGap ?? 7)));
  return { upper: result, bass };
}
