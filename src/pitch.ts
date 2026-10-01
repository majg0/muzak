/** Absolute pitch in integer thousandths of a cent above MIDI note 0.
 * This is a physical pitch coordinate, not a scale degree or MIDI note. */
export interface Pitch {
  millicents: number;
}
export type TuningId = "12tet" | "19edo" | "24edo" | "31edo";
export interface TuningDefinition {
  id: TuningId;
  name: string;
  divisions: number;
  periodMillicents: number;
  referencePitch: Pitch;
  referenceHz: number;
}
export const MILLICENTS_PER_CENT = 1000;
export const TUNINGS: Record<TuningId, TuningDefinition> = {
  "12tet": {
    id: "12tet",
    name: "12-TET",
    divisions: 12,
    periodMillicents: 1_200_000,
    referencePitch: { millicents: 6_900_000 },
    referenceHz: 440,
  },
  "19edo": {
    id: "19edo",
    name: "19-EDO",
    divisions: 19,
    periodMillicents: 1_200_000,
    referencePitch: { millicents: 6_900_000 },
    referenceHz: 440,
  },
  "24edo": { id: "24edo", name: "24-EDO", divisions: 24, periodMillicents: 1_200_000,
    referencePitch: { millicents: 6_900_000 }, referenceHz: 440 },
  "31edo": { id: "31edo", name: "31-EDO", divisions: 31, periodMillicents: 1_200_000,
    referencePitch: { millicents: 6_900_000 }, referenceHz: 440 },
};
/** Boundary adapter only. Fractional MIDI is never rounded to a semitone. */
export const midiToPitch = (midi: number): Pitch => ({
  millicents: Math.round(midi * 100_000),
});
export const pitchToMidi = (pitch: Pitch): number => pitch.millicents / 100_000;
export const pitchToHz = (pitch: Pitch): number =>
  440 * 2 ** ((pitch.millicents - 6_900_000) / 1_200_000);
export const pitchDistanceCents = (a: Pitch, b: Pitch): number =>
  Math.abs(a.millicents - b.millicents) / 1000;
/** Available pitch locations are rounded once from a rational degree address.
 * Every repeating period stays exact; repeated additions never accumulate error. */
export function degreeToPitch(id: TuningId, degree: number): Pitch {
  if (!Number.isSafeInteger(degree))
    throw new Error("Tuning degree must be an integer.");
  const tuning = TUNINGS[id];
  return {
    millicents:
      tuning.referencePitch.millicents +
      Math.round((degree * tuning.periodMillicents) / tuning.divisions),
  };
}
export function pitchToDegree(id: TuningId, pitch: Pitch): number {
  const tuning = TUNINGS[id];
  return Math.round(
    ((pitch.millicents - tuning.referencePitch.millicents) * tuning.divisions) /
      tuning.periodMillicents,
  );
}
export function pitchLabel(pitch: Pitch, id: TuningId): string {
  if (id !== "12tet") {
    const degree = pitchToDegree(id, pitch);
    const period = TUNINGS[id].divisions;
    return `d${((degree % period) + period) % period} · ${pitchToHz(pitch).toFixed(1)} Hz`;
  }
  const midi = pitchToMidi(pitch),
    n = Math.round(midi);
  return `${["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"][((n % 12) + 12) % 12]}${Math.floor(n / 12) - 1}`;
}
