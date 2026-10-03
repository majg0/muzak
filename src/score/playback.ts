import { callCore, type CoreCall } from '../core/client';
import { compilePerformance, secondsToTick, tickToSeconds, type AutomationPoint, type CompiledPerformance, type PerformanceOptions, type PerformedNote } from './performance';
import type { Score } from './score';

export interface ScorePlaybackOptions extends PerformanceOptions {
  onPosition?: (tick: number) => void;
  onEnd?: () => void;
}

/** Clip a continuous curve at a late scheduler start without jumping to its
 * next knot. Values are interpolated before mapping pitch to frequency. */
export function scheduleNoteCurve(parameter: AudioParam, points: AutomationPoint[], origin: number, start: number,
  map: (value: number) => number = value => value, exponential = false): void {
  const offset = start - origin;
  let value = points[0].value;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    if (offset <= b.seconds) {
      if (offset > a.seconds) value = a.value + (b.value - a.value) * (offset - a.seconds) / (b.seconds - a.seconds);
      break;
    }
    value = b.value;
  }
  parameter.setValueAtTime(map(value), start);
  for (const point of points) if (origin + point.seconds > start) {
    if (exponential) parameter.exponentialRampToValueAtTime(map(point.value), origin + point.seconds);
    else parameter.linearRampToValueAtTime(map(point.value), origin + point.seconds);
  }
}

/** Bounded lookahead over an already composed score. This transport never invents notes. */
export class ScorePlayer {
  private context?: AudioContext;
  private output?: GainNode;
  private timer?: ReturnType<typeof setInterval>;
  private sources = new Set<AudioScheduledSourceNode>();
  private generation = 0;
  private noise?: AudioBuffer;
  warnings: string[] = [];

  constructor(private readonly call: CoreCall = callCore) {}

  async play(score: Score, options: ScorePlaybackOptions = {}): Promise<void> {
    this.stop();
    const generation = this.generation;
    const { onPosition: _onPosition, onEnd: _onEnd, ...performanceOptions } = options;
    const performance = await this.call('compilePerformance', { score, options: performanceOptions });
    if (generation !== this.generation) return;
    this.warnings = performance.warnings;
    this.context ??= new AudioContext();
    if (!this.output) {
      this.output = this.context.createGain(); this.output.gain.value = 0.16;
      const limiter = this.context.createDynamicsCompressor();
      limiter.threshold.value = -12; limiter.knee.value = 10; limiter.ratio.value = 8;
      this.output.connect(limiter); limiter.connect(this.context.destination);
    }
    await this.context.resume();
    if (generation !== this.generation) return;
    const origin = this.context.currentTime + 0.04;
    let cursor = 0;
    const startSeconds = tickToSeconds(performance.fromTick, score.ppq, performance.tempos);
    const pump = () => {
      if (generation !== this.generation) return;
      const elapsed = Math.max(0, this.context!.currentTime - origin);
      while (cursor < performance.notes.length && performance.notes[cursor].start < elapsed + 0.2) this.schedule(performance.notes[cursor++], origin);
      options.onPosition?.(Math.min(performance.toTick, secondsToTick(startSeconds + elapsed, score.ppq, performance.tempos)));
      if (elapsed >= performance.duration + 0.1) { this.stop(); options.onEnd?.(); }
    };
    this.timer = setInterval(pump, 25); pump();
  }

  private schedule(note: PerformedNote, origin: number): void {
    const context = this.context!, start = Math.max(context.currentTime, origin + note.start), end = origin + note.end;
    if (end <= start) return;
    const envelope = context.createGain(), noteDynamics = context.createGain(), dynamics = context.createGain(), pan = context.createStereoPanner();
    envelope.connect(noteDynamics); noteDynamics.connect(dynamics); dynamics.connect(pan); pan.connect(this.output!);
    const peak = (note.note.velocity / 127) ** 1.5;
    envelope.gain.setValueAtTime(0, start);
    envelope.gain.linearRampToValueAtTime(peak, Math.min(start + 0.008, end));
    envelope.gain.setValueAtTime(peak, end);
    envelope.gain.linearRampToValueAtTime(0, end + 0.035);
    scheduleNoteCurve(noteDynamics.gain, note.noteGain, origin, start);
    for (const point of note.gain) dynamics.gain.setValueAtTime(point.value, Math.max(start, origin + point.seconds));
    for (const point of note.pan) pan.pan.setValueAtTime(point.value, Math.max(start, origin + point.seconds));
    let source: AudioScheduledSourceNode;
    let filter: BiquadFilterNode | undefined;
    if (note.percussion) {
      if (!this.noise) {
        this.noise = context.createBuffer(1, context.sampleRate / 2, context.sampleRate);
        const data = this.noise.getChannelData(0); let seed = 12345;
        for (let i = 0; i < data.length; i++) { seed = Math.imul(seed, 1664525) + 1013904223 | 0; data[i] = (seed / 2147483648) * Math.exp(-i / context.sampleRate * 30); }
      }
      const noise = context.createBufferSource(); noise.buffer = this.noise;
      filter = context.createBiquadFilter(); filter.type = 'bandpass'; filter.Q.value = 0.7;
      scheduleNoteCurve(filter.frequency, note.pitch, origin, start, value => Math.min(10000, 440 * 2 ** ((value / 100000 - 69) / 12) * 4), true);
      noise.connect(filter); filter.connect(envelope); source = noise;
    } else {
      const oscillator = context.createOscillator(); oscillator.type = 'triangle';
      scheduleNoteCurve(oscillator.frequency, note.pitch, origin, start, value => 440 * 2 ** ((value / 100000 - 69) / 12), true);
      for (const point of note.bend) oscillator.detune.setValueAtTime(point.value * 100, Math.max(start, origin + point.seconds));
      oscillator.connect(envelope); source = oscillator;
    }
    this.sources.add(source);
    source.onended = () => { this.sources.delete(source); source.disconnect(); filter?.disconnect(); envelope.disconnect(); noteDynamics.disconnect(); dynamics.disconnect(); pan.disconnect(); };
    source.start(start); source.stop(end + 0.04);
  }

  stop(): void {
    this.generation++;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    for (const source of this.sources) { try { source.stop(); } catch { /* Already ended. */ } }
    this.sources.clear();
  }

  dispose(): void { this.stop(); void this.context?.close(); this.context = undefined; this.output = undefined; this.noise = undefined; }
}

export { compilePerformance, type CompiledPerformance };
