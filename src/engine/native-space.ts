import { TUNINGS, type TuningId } from '../pitch';

export type NativeTuningId = Exclude<TuningId, '12tet'>;
export const nativeClass = (degree: number, tuning: NativeTuningId): number => {
  const period = TUNINGS[tuning].divisions;
  return ((degree % period) + period) % period;
};

/** Only these three octave-periodic experiments are supported. Physical
 * constraints are shared; their chosen scales/chord preferences are explicit
 * in lyrical-support/harmonic-tools, never twelve-tone tables modulo N. */
export function nativeSpace(tuning: NativeTuningId) {
  const period = TUNINGS[tuning].divisions;
  const step = (cents: number) => Math.max(1, Math.round(cents * period / 1200));
  const range = (lo: number, hi: number): readonly [number, number] =>
    [Math.ceil((lo - 6900) * period / 1200), Math.floor((hi - 6900) * period / 1200)];
  return { period, step, fifth: step(702), fourth: step(498),
    voices: [range(4800, 6800), range(5300, 7300), range(5800, 7800), range(6300, 8500)],
    bass: range(2800, 5200), minimumGap: Math.ceil(160 * period / 1200),
    maximumGap: Math.floor(1400 * period / 1200), span: Math.floor(3100 * period / 1200),
    bassGap: Math.ceil(650 * period / 1200) };
}

export function validNativeVoices(degrees: number[], tuning: NativeTuningId): boolean {
  const space = nativeSpace(tuning);
  return degrees.length === 4 && degrees.every((degree, index) => Number.isInteger(degree)
    && degree >= space.voices[index][0] && degree <= space.voices[index][1]
    && (!index || degree - degrees[index - 1] >= space.minimumGap && degree - degrees[index - 1] <= space.maximumGap))
    && degrees[3] - degrees[0] <= space.span;
}
