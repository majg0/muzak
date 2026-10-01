import { MusicEngine, eventHash } from './engine';
import { lyricalPerformance } from './lyrical';
import { renderOffline } from './audio';
import { selectLyricalArgument } from './lyrical-audit';
import type { HarmonyConfig } from './harmonic-language';
import type { Frame, Performance } from './types';

const strategies = ['functional', 'tonnetz', 'third-cycle'] as const;
const names: Record<HarmonyConfig['strategy'], string> = {
  balanced: 'Directed harmony', functional: 'Functional departures & cadences',
  tonnetz: 'Common-tone transformations', 'third-cycle': 'Third-cycle regions',
};
export const melodySignature = (frames: Frame[]) => eventHash(frames.flatMap(frame => frame.notes)
  .filter(note => note.part === 'melody').map(note => ({ tick: note.tick, duration: note.duration,
    pitch: note.absolutePitch?.millicents, source: note.expression?.sourceId })));

/** A controlled audition: same new seed recipe and protected melody, only
 * harmonic strategy differs. Retains native pitch/spectrum configuration. */
export async function composeThematicComparison(source: Performance, onProgress?: (message: string) => void) {
  const base = lyricalPerformance(source).recipe;
  base.phrasing!.harmony!.treatment = 'reharmonize';
  base.phrasing!.harmony!.harmonicColor = .68;
  const cases: { strategy: typeof strategies[number]; recipe: Performance; frames: Frame[]; generationMs: number }[] = [];
  let startTick = 0, endTick = 0;
  for (const strategy of strategies) {
    const recipe = structuredClone(base); recipe.phrasing!.harmony!.strategy = strategy;
    const engine = new MusicEngine({ ...recipe, parameters: recipe.initialParameters }), generated: Frame[] = [];
    let generationMs = 0;
    for (let index = 0; index < 320; index++) {
      const before = performance.now(), frame = engine.step(); generationMs += performance.now() - before; generated.push(frame);
      if (!endTick) {
        const argument = selectLyricalArgument(generated);
        if (argument) { startTick = argument.first.startTick; endTick = argument.last.endTick; }
      }
      if (endTick && frame.tick + frame.duration >= endTick) break;
      if (index % 8 === 7) { onProgress?.(`Composing ${names[strategy]} · ${index + 1} frames`); await new Promise<void>(resolve => setTimeout(resolve, 0)); }
    }
    if (!endTick || generated.at(-1)!.tick + generated.at(-1)!.duration < endTick) throw new Error('No complete thematic argument was available within the comparison limit.');
    const frames = generated.filter(frame => frame.tick >= startTick && frame.tick < endTick);
    cases.push({ strategy, recipe, frames, generationMs });
  }
  const signatures = cases.map(item => melodySignature(item.frames));
  if (!signatures.every(value => value === signatures[0])) throw new Error('The comparison changed the melody; refusing to present it as a controlled reharmonization.');
  const backingHashes = cases.map(item => eventHash(item.frames.flatMap(frame => frame.notes).filter(note => note.part !== 'melody')));
  return { cases, melodyHash: signatures[0], startTick, endTick, distinctReadings: new Set(backingHashes).size };
}

export async function renderThematicComparison(source: Performance, options: {
  onProgress?: (message: string) => void;
  onRendered?: (label: string, buffer: AudioBuffer) => void;
} = {}) {
  const composed = await composeThematicComparison(source, options.onProgress);
  const first = composed.cases[0].frames;
  const variants = [{ label: 'The protected core · melody alone', frames: first.map(frame => ({ ...frame, notes: frame.notes.filter(note => note.part === 'melody') })) },
    ...composed.cases.map(item => ({ label: names[item.strategy], frames: item.frames }))];
  const signals = [];
  for (const variant of variants) {
    options.onProgress?.(`Rendering ${variant.label}`);
    const buffer = await renderOffline(variant.frames, .65);
    let peak = 0, squares = 0, nonFinite = 0, clipped = 0;
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) for (const sample of buffer.getChannelData(channel)) {
      if (!Number.isFinite(sample)) { nonFinite++; continue; }
      squares += sample * sample; peak = Math.max(peak, Math.abs(sample)); if (Math.abs(sample) >= .999) clipped++;
    }
    const rms = Math.sqrt(squares / (buffer.length * buffer.numberOfChannels));
    signals.push({ label: variant.label, seconds: buffer.duration, peak, rms, nonFinite, clipped });
    if (nonFinite || clipped || rms < .0001) throw new Error(`Invalid audio render: ${variant.label}`);
    options.onRendered?.(variant.label, buffer);
  }
  return { seed: source.seed, tuning: first[0].sound.tuning, melodyHash: composed.melodyHash,
    melodyNotes: first.flatMap(frame => frame.notes).filter(note => note.part === 'melody').length,
    bars: (composed.endTick - composed.startTick) / first[0].form!.barTicks, distinctReadings: composed.distinctReadings,
    core: first[0].phrase?.themeCore, signals,
    cases: composed.cases.map(item => ({ strategy: item.strategy, generationMs: item.generationMs,
      eventHash: eventHash(item.frames.flatMap(frame => frame.notes)),
      destinations: [...new Map(item.frames.flatMap(frame => frame.diagnostics.harmonicPlan ? [frame.diagnostics.harmonicPlan.current] : []).map(goal => [goal.id, goal])).values()],
      realizations: item.frames.flatMap(frame => frame.diagnostics.harmonicPlan && frame.tick === frame.diagnostics.harmonicPlan.current.startTick
        ? [{ tick: frame.tick, ...frame.diagnostics.harmonicPlan.realization }] : []),
    })),
    method: 'Native browser audio renders and measured signals. Identical physical melody pitches, durations, onsets and source identities are checked before presenting the comparison. Musical quality requires listening.',
  };
}
