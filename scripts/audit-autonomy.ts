import { DEFAULT_CONDUCTOR } from '../src/conductor';
import { MusicEngine, eventHash } from '../src/engine';
import { DEFAULT_PARAMETERS } from '../src/parameters';
import type { Frame } from '../src/types';

for (const seed of ['velvet-orbit', 'glass-garden', 'amber-river']) {
  const engine = new MusicEngine({ seed, parameters: DEFAULT_PARAMETERS, conductor: DEFAULT_CONDUCTOR });
  const frames: Frame[] = [];
  const start = performance.now();
  while (frames.length < 320) {
    const frame = engine.step();
    if (frame.form!.cycle > 0) break;
    frames.push(frame);
  }
  const roles = [...new Set(frames.map(frame => frame.form!.role))].map(role => {
    const group = frames.filter(frame => frame.form!.role === role);
    const mean = (get: (frame: Frame) => number) => +(group.reduce((sum, frame) => sum + get(frame), 0) / group.length).toFixed(3);
    return { role, frames: group.length, dissonance: mean(frame => frame.diagnostics.dissonance), target: mean(frame => frame.diagnostics.targetTension), actual: mean(frame => frame.diagnostics.actualTension), movementCents: mean(frame => frame.diagnostics.voiceLeadingCents), melodicNotes: group.flatMap(frame => frame.notes).filter(note => note.part === 'melody').length, percussion: group.flatMap(frame => frame.notes).filter(note => note.part === 'percussion').length, tempo: mean(frame => frame.parameters.tempo) };
  });
  console.log(JSON.stringify({ seed, frames: frames.length, msPerFrame: +((performance.now() - start) / frames.length).toFixed(2), targetRange: [Math.min(...frames.map(frame => frame.diagnostics.targetTension)), Math.max(...frames.map(frame => frame.diagnostics.targetTension))], tempoRange: [Math.min(...frames.map(frame => frame.parameters.tempo)), Math.max(...frames.map(frame => frame.parameters.tempo))], meters: [...new Set(frames.map(frame => `${frame.form!.meter.numerator}/${frame.form!.meter.denominator}`))], grooves: [...new Set(frames.map(frame => frame.form!.grooveId))], themes: [...new Set(frames.map(frame => frame.form!.themeId))], glideFrames: frames.filter(frame => frame.notes.some(note => note.endPitch)).map(frame => frame.index), roles, hash: eventHash(frames.flatMap(frame => frame.notes)) }));
}
