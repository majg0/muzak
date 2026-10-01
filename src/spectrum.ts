import type { TuningId } from "./pitch";
export interface SpectralPartial {
  ratio: number;
  amplitude: number;
}
export interface Spectrum {
  id: string;
  name: string;
  partials: SpectralPartial[];
}
export interface SoundConfig {
  tuning: TuningId;
  instrument: "ensemble" | "additive";
  spectrum: Spectrum;
  roughnessWeight: number;
  roughnessTarget: number;
}
/** These same five partials are consumed by the oscillator bank and model. */
export const SPECTRA: Spectrum[] = [
  {
    id: "harmonic-five",
    name: "Harmonic · five partials",
    partials: [
      { ratio: 1, amplitude: 1 },
      { ratio: 2, amplitude: 0.5 },
      { ratio: 3, amplitude: 0.3 },
      { ratio: 4, amplitude: 0.18 },
      { ratio: 5, amplitude: 0.1 },
    ],
  },
  {
    id: "stretched-five",
    name: "Stretched · five partials",
    partials: [
      { ratio: 1, amplitude: 1 },
      { ratio: 2.05, amplitude: 0.5 },
      { ratio: 3.13, amplitude: 0.3 },
      { ratio: 4.26, amplitude: 0.18 },
      { ratio: 5.4, amplitude: 0.1 },
    ],
  },
];
export const DEFAULT_SOUND: SoundConfig = {
  tuning: "12tet",
  instrument: "ensemble",
  spectrum: SPECTRA[0],
  roughnessWeight: 0,
  roughnessTarget: 0.25,
};
