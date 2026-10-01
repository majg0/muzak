import type { NoteEvent } from './types';
import type { Pitch } from './pitch';

export type GainEnvelope = NonNullable<NoteEvent['gainEnvelope']>;

/** Physical pitch at an absolute musical tick. Missing glide time means the
 * original note duration; a zero-time glide arrives immediately. Invalid
 * glide-time metadata falls back to duration rather than producing NaN. */
export function notePitchAt(note: Pick<NoteEvent, 'absolutePitch' | 'midiNote' | 'endPitch' | 'glideTicks' | 'tick' | 'duration'>,
  tick: number): Pitch | undefined {
  const start = note.absolutePitch ?? (note.midiNote === undefined ? undefined : { millicents: Math.round(note.midiNote * 100_000) });
  if (!start) return;
  if (!note.endPitch || tick < note.tick) return { ...start };
  const glide = Number.isFinite(note.glideTicks) ? Math.max(0, note.glideTicks!) : note.duration;
  const phase = Number.isFinite(glide) && glide > 0 ? Math.min(1, Math.max(0, (tick - note.tick) / glide)) : 1;
  return { millicents: Math.round(start.millicents + (note.endPitch.millicents - start.millicents) * phase) };
}

/** Linear interpolation in note-relative integer musical ticks. Endpoint
 * values are held outside the declared span; an absent envelope is unity. */
export function gainEnvelopeAt(points: readonly GainEnvelope[number][] | undefined, tick: number): number {
  if (!points?.length) return 1;
  if (tick <= points[0].tick) return points[0].gain;
  for (let index = 1; index < points.length; index++) {
    const right = points[index], left = points[index - 1];
    if (tick <= right.tick) return left.gain + (right.gain - left.gain) * (tick - left.tick) / (right.tick - left.tick);
  }
  return points[points.length - 1].gain;
}

/** Clip a written gain trajectory without accelerating its remaining shape.
 * The new note-off gets the old trajectory's interpolated value. Inputs stay
 * untouched; callers can use this for rests, phrase ends and short supports. */
export function clipGainEnvelope(points: readonly GainEnvelope[number][] | undefined, duration: number): GainEnvelope | undefined {
  if (!points?.length) return undefined;
  if (!Number.isSafeInteger(duration) || duration <= 0) throw new RangeError('A gain envelope needs a positive integer note duration.');
  for (let index = 0; index < points.length; index++) {
    const point = points[index];
    if (!Number.isSafeInteger(point.tick) || point.tick < 0 || !Number.isFinite(point.gain) || point.gain < 0 || point.gain > 1 || index > 0 && point.tick <= points[index - 1].tick) {
      throw new RangeError('Gain-envelope points need increasing integer ticks and gains between zero and one.');
    }
  }
  return [{ tick: 0, gain: gainEnvelopeAt(points, 0) },
    ...points.filter(point => point.tick > 0 && point.tick < duration).map(point => ({ ...point })),
    { tick: duration, gain: gainEnvelopeAt(points, duration) }];
}
