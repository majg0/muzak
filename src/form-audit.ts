import { MusicEngine, eventHash } from './engine';
import { DEFAULT_CONDUCTOR, formAt } from './conductor';
import { DEFAULT_PARAMETERS } from './parameters';
import { DEFAULT_SOUND } from './spectrum';
import { PPQ, type Frame, type ParameterKey } from './types';
import { renderOffline } from './audio';

export function composeFormAudit(seed = 'velvet-orbit') {
  const conductor = { ...DEFAULT_CONDUCTOR, pace: 1 };
  let end = 0;
  for (let i = 0; i < 8; i++) end = formAt(seed, end, conductor).sectionEndTick;
  const engine = new MusicEngine({ seed, parameters: DEFAULT_PARAMETERS, sound: DEFAULT_SOUND, conductor });
  const start = performance.now();
  const frames: Frame[] = [];
  while (engine.tick < end) frames.push(engine.step());
  const msPerFrame = (performance.now() - start) / frames.length;
  const keys = Object.keys(DEFAULT_PARAMETERS) as ParameterKey[];
  const ranges = Object.fromEntries(keys.map(key => [key, [Math.min(...frames.map(f => f.parameters[key])), Math.max(...frames.map(f => f.parameters[key]))]]));
  const sections = [...new Set(frames.map(f => f.form!.sectionIndex))].map(index => {
    const part = frames.filter(f => f.form!.sectionIndex === index), form = part[0].form!;
    const average = (fn: (frame: Frame) => number) => part.reduce((sum, f) => sum + fn(f), 0) / part.length;
    return { index, name: form.sectionName, role: form.role, meter: `${form.meter.numerator}/${form.meter.denominator}`, tuning: form.tuning,
      theme: form.themeId, groove: form.grooveId, color: form.instrument, subdivisionTicks: form.subdivisionTicks,
      frames: part.length, meanDissonance: average(f => f.diagnostics.dissonance), meanTargetTension: average(f => f.diagnostics.targetTension),
      meanActualTension: average(f => f.diagnostics.actualTension), tempo: part[0].parameters.tempo,
      melodyNotes: part.flatMap(f => f.notes).filter(n => n.part === 'melody').length,
      drumHits: part.flatMap(f => f.notes).filter(n => n.part === 'percussion').length,
      glideNotes: part.flatMap(f => f.notes).filter(n => n.endPitch).length };
  });
  const notes = frames.flatMap(f => f.notes);
  return { frames, report: { seed, frameCount: frames.length, eventCount: notes.length, eventHash: eventHash(notes), msPerFrame,
    ranges, sections, finite: notes.every(n => Number.isFinite(n.velocity) && Number.isInteger(n.tick) && Number.isInteger(n.duration)) } };
}

export async function auditAutonomousForm(options: {
  onProgress?: (message: string) => void;
  onRendered?: (buffer: AudioBuffer) => void | Promise<void>;
} = {}) {
  options.onProgress?.('Composing a complete form with returning themes, changing meter and tuning journeys…');
  const { frames, report } = composeFormAudit();
  options.onProgress?.(`Rendering ${frames.length} frames through the live instrument rack…`);
  await new Promise(resolve => setTimeout(resolve, 0));
  const buffer = await renderOffline(frames, .65);
  const channel = buffer.getChannelData(0);
  let seconds = 0;
  const spans = new Map<number, { start: number; end: number }>();
  for (const frame of frames) {
    const duration = frame.duration * 60 / frame.parameters.tempo / PPQ;
    const index = frame.form!.sectionIndex;
    const span = spans.get(index) ?? { start: seconds, end: 0 };
    span.end = seconds + duration; spans.set(index, span); seconds += duration;
  }
  let invalid = 0, peak = 0;
  for (let c = 0; c < buffer.numberOfChannels; c++) for (const sample of buffer.getChannelData(c)) { if (!Number.isFinite(sample)) invalid++; peak = Math.max(peak, Math.abs(sample)); }
  const levels = [...spans].map(([index, span]) => {
    let sum = 0, count = 0;
    for (let i = Math.ceil(span.start * buffer.sampleRate); i < Math.floor(span.end * buffer.sampleRate); i++) { sum += channel[i] ** 2; count++; }
    return { section: report.sections.find(s => s.index === index)!.name, rms: Math.sqrt(sum / Math.max(1, count)) };
  });
  await options.onRendered?.(buffer);
  return { ...report, durationSeconds: seconds, sampleRate: buffer.sampleRate, peak, invalidSamples: invalid, sectionLevels: levels,
    passed: report.finite && invalid === 0 && peak > .01 && peak < .98 && levels.every(level => level.rms > .0005),
    evaluated: 'Actual browser PCM was measured for finite samples, signal energy and clipping. This is not a subjective listening assessment.' };
}
