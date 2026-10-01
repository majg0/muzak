import { PPQ, type Frame, type NoteEvent } from './types';
import { midiToPitch, pitchToHz, type Pitch } from './pitch';
import type { SoundConfig } from './spectrum';
import { partialsForPitches } from './roughness';
import type { InstrumentColor } from './conductor';
import { restAppliesToNote } from './phrasing';
import { clipGainEnvelope, gainEnvelopeAt, type GainEnvelope } from './note-expression';

const clamp = (value: number, low = 0, high = 1) => Math.min(high, Math.max(low, value));
const secondsPerTick = (frame: Frame) => 60 / clamp(frame.parameters.tempo, 20, 300) / PPQ;
type PartialBank = Array<[OscillatorType, number, number]>;
type PhraseRest = NonNullable<Frame['phrase']>['rests'][number];
interface AudioTask { time: number; kind: 'boundary' | 'rest' | 'note'; run: () => void; }

type ParamEvent = { kind: 'set' | 'linear' | 'exponential' | 'target'; value: number; time: number; constant?: number };
const automation = new WeakMap<AudioParam, ParamAutomation>();

/** Some browsers do not implement cancelAndHoldAtTime. Track the small envelope
 * we schedule so its fallback can hold the value at the requested FUTURE time,
 * rather than the parameter's current value. Reinstating the truncated ramp
 * also preserves its approach to the boundary after cancelScheduledValues. */
class ParamAutomation {
  private events: ParamEvent[] = [];
  private initial: number;
  constructor(private readonly param: AudioParam) { this.initial = param.value; }
  private record(event: ParamEvent): void {
    this.events = this.events.filter(previous => previous.kind !== event.kind || previous.time !== event.time);
    this.events.push(event); this.events.sort((a, b) => a.time - b.time);
  }
  setValueAtTime(value: number, time: number): void {
    this.param.setValueAtTime(value, time); this.record({ kind: 'set', value, time });
  }
  linearRampToValueAtTime(value: number, time: number): void {
    this.param.linearRampToValueAtTime(value, time); this.record({ kind: 'linear', value, time });
  }
  exponentialRampToValueAtTime(value: number, time: number): void {
    this.param.exponentialRampToValueAtTime(value, time); this.record({ kind: 'exponential', value, time });
  }
  setTargetAtTime(value: number, time: number, constant: number): void {
    this.param.setTargetAtTime(value, time, constant); this.record({ kind: 'target', value, time, constant });
  }
  private at(time: number): { value: number; kind: 'set' | 'linear' | 'exponential' } {
    let previousTime = 0, value = this.initial;
    let target: ParamEvent | undefined;
    const decay = (until: number) => target ? target.value + (value - target.value) * Math.exp(-(until - previousTime) / target.constant!) : value;
    for (const event of this.events) {
      if (event.time > time) {
        if (event.kind === 'linear' || event.kind === 'exponential') {
          const fraction = clamp((time - previousTime) / Math.max(1e-12, event.time - previousTime));
          return { value: event.kind === 'exponential' && value > 0 && event.value > 0
            ? value * (event.value / value) ** fraction : value + (event.value - value) * fraction, kind: event.kind };
        }
        return { value: decay(time), kind: 'set' };
      }
      if (event.kind === 'target') { value = decay(event.time); target = event; }
      else { value = event.value; target = undefined; }
      previousTime = event.time;
      if (event.time === time && (event.kind === 'linear' || event.kind === 'exponential')) return { value, kind: event.kind };
    }
    return { value: decay(time), kind: 'set' };
  }
  cancelAndHoldAtTime(time: number): void {
    const held = this.at(time);
    if (typeof this.param.cancelAndHoldAtTime === 'function') this.param.cancelAndHoldAtTime(time);
    else {
      this.param.cancelScheduledValues(time);
      if (held.kind === 'linear') this.param.linearRampToValueAtTime(held.value, time);
      else if (held.kind === 'exponential' && held.value > 0) this.param.exponentialRampToValueAtTime(held.value, time);
      else this.param.setValueAtTime(held.value, time);
    }
    // Holds are chronological for a voice. One held anchor replaces its old
    // history, bounding memory even when a common tone lasts many minutes.
    this.initial = held.value;
    // Retain the incoming ramp kind: two snare sources share one envelope and
    // can hold the same boundary twice. The outgoing release must not replace
    // that approach with a different curve on the second hold.
    this.events = [{ kind: held.kind, value: held.value, time }];
  }
}

function automate(param: AudioParam): ParamAutomation {
  let result = automation.get(param);
  if (!result) { result = new ParamAutomation(param); automation.set(param, result); }
  return result;
}

/** Explicit ensemble oscillator colors. The additive experiment bypasses this
 * palette and continues to use only its declared shared spectrum. */
export function ensemblePartials(color: InstrumentColor, brightness: number): PartialBank {
  switch (color) {
    case 'round': return [['sine', 1, 0.9], ['triangle', 1, 0.2], ['sine', 2, 0.04]];
    case 'glass': return [['sine', 1, 0.72], ['sine', 2.01, 0.24], ['sine', 3.98, 0.12], ['sine', 5.43, 0.055]];
    case 'reed': return [['triangle', 1, 0.7], ['sine', 1, 0.16], ['sine', 3, 0.22 + brightness * 0.06], ['sine', 5, 0.08]];
    case 'pluck': return [['sine', 1, 0.88], ['sine', 2, 0.18], ['sine', 3, 0.06 + brightness * 0.08]];
    case 'keys': return [['sine', 1, 0.85], ['triangle', 1, 0.15], ['sine', 2, 0.12 + brightness * 0.11]];
    case 'strings': return [['triangle', 1, .5], ['sine', 1, .35], ['sine', 2, .16], ['sine', 3, .055 + brightness * .025]];
    case 'flute': return [['sine', 1, .92], ['sine', 2, .09 + brightness * .08], ['sine', 3, .025]];
    case 'brass': return [['sawtooth', 1, .18], ['sine', 1, .58], ['sine', 2, .22 + brightness * .06], ['sine', 3, .1]];
    case 'lead': return [['sawtooth', 1, .2], ['triangle', 1, .48], ['sine', 2, .12], ['sine', 3, .07 + brightness * .06]];
  }
}

// The synth has its own addressed domain; no audio decision consumes the
// composer's randomness. Noise and small performance offsets are reproducible.
function addressed(id: string, decision: number): number {
  let hash = (2166136261 ^ decision) >>> 0;
  for (let i = 0; i < id.length; i++) hash = Math.imul(hash ^ id.charCodeAt(i), 16777619) >>> 0;
  hash ^= hash >>> 16; hash = Math.imul(hash, 0x7feb352d); hash ^= hash >>> 15;
  return (hash >>> 0) / 4294967296;
}

interface ActiveVoice {
  millicents: number; toneKey: string; end: number; envelope: GainNode; sources: OscillatorNode[]; level: number;
  startTick: number; endTick: number; startTime: number; release: number; stopPadding: number;
  shape: 'harmony' | 'bass' | 'melody' | 'solo' | 'additive' | 'detached';
  articulation?: NoteEvent['articulation'];
  attackEndTime?: number;
  part: NoteEvent['part']; voice: number; restCut?: boolean;
  glide?: { startTick: number; endTick: number; from: Pitch; to: Pitch; endTime: number; ratios: number[] };
  dynamics?: { node: GainNode; originTick: number; points?: GainEnvelope; tickSeconds: number };
}
interface ActiveHit { startTick: number; end: number; envelope: GainNode; source: AudioScheduledSourceNode; }

/** A small, sample-free instrument rack shared by live and offline playback. */
class InstrumentRack {
  readonly output: GainNode;
  readonly analyser: AnalyserNode;
  private readonly dry: GainNode;
  private readonly percussionDry: GainNode;
  private readonly reverbSend: GainNode;
  private readonly delaySend: GainNode;
  private readonly delay: DelayNode;
  private readonly noise: AudioBuffer;
  private readonly sources = new Set<AudioScheduledSourceNode>();
  private readonly upperVoices = new Map<number, ActiveVoice>();
  private readonly sustaining = new Set<ActiveVoice>();
  private readonly hits = new Set<ActiveHit>();

  get sourceCount(): number { return this.sources.size; }

  constructor(private readonly context: BaseAudioContext, volume: number) {
    this.output = context.createGain();
    this.output.gain.value = volume * 0.78;
    this.dry = context.createGain(); this.dry.gain.value = 0.9;
    this.percussionDry = context.createGain(); this.percussionDry.gain.value = 0.9;
    this.reverbSend = context.createGain(); this.reverbSend.gain.value = 0.19;
    this.delaySend = context.createGain(); this.delaySend.gain.value = 0.105;
    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -18; compressor.knee.value = 15;
    compressor.ratio.value = 2.5; compressor.attack.value = 0.015; compressor.release.value = 0.3;
    const warmth = context.createBiquadFilter(); warmth.type = 'lowpass'; warmth.frequency.value = 6500; warmth.Q.value = 0.3;
    this.dry.connect(warmth); warmth.connect(compressor); this.percussionDry.connect(compressor); compressor.connect(this.output);
    this.analyser = context.createAnalyser(); this.analyser.fftSize = 256;
    this.output.connect(this.analyser); this.analyser.connect(context.destination);

    const reverb = context.createConvolver(); reverb.buffer = this.makeNoise(2.5, true);
    const reverbTone = context.createBiquadFilter(); reverbTone.type = 'lowpass'; reverbTone.frequency.value = 3200;
    this.reverbSend.connect(reverb); reverb.connect(reverbTone); reverbTone.connect(warmth);
    this.delay = context.createDelay(2); this.delay.delayTime.value = 0.37;
    const feedback = context.createGain(); feedback.gain.value = 0.25;
    const delayTone = context.createBiquadFilter(); delayTone.type = 'lowpass'; delayTone.frequency.value = 2200;
    const delayPan = context.createStereoPanner(); delayPan.pan.value = -0.3;
    this.delaySend.connect(this.delay); this.delay.connect(delayTone); delayTone.connect(feedback); feedback.connect(this.delay);
    delayTone.connect(delayPan); delayPan.connect(warmth);
    this.noise = this.makeNoise(0.6, false);
  }

  private makeNoise(seconds: number, impulse: boolean): AudioBuffer {
    const length = Math.ceil(this.context.sampleRate * seconds);
    const buffer = this.context.createBuffer(impulse ? 2 : 1, length, this.context.sampleRate);
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
      const data = buffer.getChannelData(channel);
      let random = (0x6d2b79f5 ^ (channel * 0x9e3779b9)) >>> 0;
      let previous = 0;
      for (let i = 0; i < length; i++) {
        random ^= random << 13; random ^= random >>> 17; random ^= random << 5;
        const white = ((random >>> 0) / 2147483648 - 1);
        previous = previous * 0.45 + white * 0.55;
        data[i] = impulse ? previous * Math.exp(-i / this.context.sampleRate * 3.5) * Math.min(1, i / 250) : white;
      }
    }
    return buffer;
  }

  setVolume(volume: number): void { automate(this.output.gain).setTargetAtTime(clamp(volume) * 0.78, this.context.currentTime, 0.025); }

  fadeOut(): void {
    automate(this.output.gain).cancelAndHoldAtTime(this.context.currentTime);
    automate(this.output.gain).linearRampToValueAtTime(0, this.context.currentTime + 0.015);
  }

  private attach(source: AudioScheduledSourceNode, clean?: () => void): void {
    this.sources.add(source);
    source.onended = () => { this.sources.delete(source); source.disconnect(); clean?.(); };
  }

  private connectVoice(envelope: GainNode, pan: number, wet: number, percussionAttack = false): () => void {
    const panner = this.context.createStereoPanner(); panner.pan.value = pan;
    envelope.connect(panner); panner.connect(percussionAttack ? this.percussionDry : this.dry);
    let send: GainNode | undefined;
    if (wet) {
      send = this.context.createGain(); send.gain.value = wet;
      panner.connect(send); send.connect(this.reverbSend); send.connect(this.delaySend);
    }
    return () => { envelope.disconnect(); panner.disconnect(); send?.disconnect(); };
  }

  private oscillators(time: number, until: number, fundamentalHz: number, envelope: GainNode,
    partials: PartialBank, cleanup: () => void): OscillatorNode[] {
    return partials.map(([type, multiplier, strength], index) => {
      const osc = this.context.createOscillator(); const gain = this.context.createGain();
      osc.type = type; osc.frequency.value = fundamentalHz * multiplier; gain.gain.value = strength;
      osc.connect(gain); gain.connect(envelope);
      this.attach(osc, () => { gain.disconnect(); if (index === 0) cleanup(); });
      osc.start(time); osc.stop(until); return osc;
    });
  }

  private startGlide(voice: ActiveVoice, note: NoteEvent, start: Pitch, ratios: number[], tickSeconds: number): void {
    if (!note.endPitch || note.endPitch.millicents === start.millicents) return;
    const ticks = note.glideTicks ?? note.duration;
    if (!Number.isSafeInteger(ticks) || ticks <= 0) throw new RangeError('A glide needs a positive integer tick duration.');
    const endTime = voice.startTime + ticks * tickSeconds;
    voice.glide = { startTick: note.tick, endTick: note.tick + ticks, from: start, to: note.endPitch, endTime, ratios };
    voice.millicents = note.endPitch.millicents;
    voice.sources.forEach((source, i) => {
      automate(source.frequency).setValueAtTime(pitchToHz(start) * ratios[i], voice.startTime);
      automate(source.frequency).exponentialRampToValueAtTime(pitchToHz(note.endPitch!) * ratios[i], endTime);
    });
  }

  /** A separate musical gain stage leaves the instrument's attack and the
   * short rest release intact. Holding a pitch need not hold its loudness. */
  private startDynamics(voice: ActiveVoice, note: NoteEvent, time: number, tickSeconds: number, tied = false): void {
    const dynamics = voice.dynamics;
    if (!dynamics) return;
    const points = clipGainEnvelope(note.gainEnvelope, note.duration);
    const gain = automate(dynamics.node.gain);
    if (tied) {
      gain.cancelAndHoldAtTime(time);
      const firstPoint = points?.find(point => point.tick > 0)?.tick ?? note.duration;
      gain.linearRampToValueAtTime(gainEnvelopeAt(points, 0), time + Math.min(.025, firstPoint * tickSeconds * .5));
    } else gain.setValueAtTime(gainEnvelopeAt(points, 0), time);
    for (const point of points ?? []) if (point.tick > 0) gain.linearRampToValueAtTime(point.gain, time + point.tick * tickSeconds);
    dynamics.originTick = note.tick; dynamics.points = points; dynamics.tickSeconds = tickSeconds;
  }

  /** Rest boundaries are dry-source events, not master/effect mutes. A short
   * release leaves room for the phrase while ambience decays naturally. */
  private rest(rest: PhraseRest, tick: number, time: number, tickSeconds: number): void {
    const release = Math.min(0.035, (rest.endTick - tick) * tickSeconds * 0.4);
    const padding = Math.min(0.005, release * 0.15);
    for (const voice of this.sustaining) {
      if (voice.restCut || !restAppliesToNote(voice, rest) || voice.startTick >= rest.endTick || voice.end + voice.release <= time) continue;
      automate(voice.envelope.gain).cancelAndHoldAtTime(time);
      automate(voice.envelope.gain).linearRampToValueAtTime(0, time + release);
      if (voice.dynamics) automate(voice.dynamics.node.gain).cancelAndHoldAtTime(time);
      for (const source of voice.sources) source.stop(time + release + padding);
      voice.endTick = Math.min(voice.endTick, tick); voice.end = time; voice.release = release; voice.stopPadding = padding; voice.restCut = true;
      if (this.upperVoices.get(voice.voice) === voice) this.upperVoices.delete(voice.voice);
    }
    if (restAppliesToNote({ part: 'percussion', voice: 9 }, rest)) for (const hit of this.hits) {
      if (hit.startTick >= rest.endTick || hit.end <= time) continue;
      const drumRelease = Math.min(0.018, release);
      automate(hit.envelope.gain).cancelAndHoldAtTime(time); automate(hit.envelope.gain).linearRampToValueAtTime(0, time + drumRelease);
      hit.source.stop(time + drumRelease + padding); hit.end = time + drumRelease + padding;
    }
  }

  /** Build small chronological actions without allocating oscillators. Live
   * playback schedules them in bounded look-ahead slices; offline rendering
   * executes the identical list immediately against its virtual audio clock. */
  frameTasks(frame: Frame, time: number): AudioTask[] {
    const tickSeconds = secondsPerTick(frame);
    const actions: AudioTask[] = [{ time, kind: 'boundary', run: () => this.retimeAtBoundary(frame.tick, time, tickSeconds) }];
    const rests = (frame.phrase?.rests ?? []).filter(rest => Number.isSafeInteger(rest.startTick) && Number.isSafeInteger(rest.endTick) && rest.endTick > rest.startTick);
    const boundaries = rests.filter(rest => rest.endTick > frame.tick && rest.startTick < frame.tick + frame.duration)
      .map(rest => ({ rest, tick: Math.max(frame.tick, rest.startTick) })).sort((a, b) => a.tick - b.tick);
    for (const boundary of boundaries) {
      const at = time + (boundary.tick - frame.tick) * tickSeconds;
      actions.push({ time: at, kind: 'rest', run: () => this.rest(boundary.rest, boundary.tick, at, tickSeconds) });
    }
    for (const note of [...frame.notes].sort((a, b) => a.tick - b.tick || a.voice - b.voice)) {
      if (!Number.isFinite(note.tick) || !Number.isFinite(note.duration) || note.duration <= 0) continue;
      const applicable = rests.filter(rest => restAppliesToNote(note, rest));
      if (applicable.some(rest => note.tick >= rest.startTick && note.tick < rest.endTick)) continue;
      let endTick = note.tick + note.duration;
      for (const rest of applicable) if (rest.startTick > note.tick && rest.startTick < endTick) endTick = rest.startTick;
      if (endTick <= note.tick) continue;
      const bounded = endTick === note.tick + note.duration ? note : { ...note, duration: endTick - note.tick,
        ...(note.endPitch ? { glideTicks: note.glideTicks ?? note.duration } : {}) };
      const at = time + Math.max(0, note.tick - frame.tick) * tickSeconds;
      actions.push({ time: at, kind: 'note', run: () => this.note(bounded, at, bounded.duration * tickSeconds, frame.parameters.brightness, frame.sound) });
    }
    const priority = { boundary: 0, rest: 1, note: 2 };
    return actions.sort((a, b) => a.time - b.time || priority[a.kind] - priority[b.kind]);
  }

  scheduleFrame(frame: Frame, time: number): void {
    for (const action of this.frameTasks(frame, time)) action.run();
  }

  /** A note's end belongs to the musical tick clock. A newly committed frame
   * reveals the tempo for its span, so retime crossing notes before that frame
   * is audible. This never requests future engine frames or assumes future
   * edits. Repeated stop() calls replace a source's earlier scheduled stop. */
  retimeAtBoundary(tick: number, time: number, tickSeconds: number): void {
    for (const hit of this.hits) if (hit.end <= time) this.hits.delete(hit);
    for (const voice of this.sustaining) {
      if (voice.restCut || voice.endTick <= tick) {
        if (voice.end + voice.release + voice.stopPadding <= time) this.sustaining.delete(voice);
        continue;
      }
      if (voice.startTick >= tick) continue;
      const dynamics = voice.dynamics;
      if (dynamics?.points && Math.abs(dynamics.tickSeconds - tickSeconds) >= 1e-12) {
        const gain = automate(dynamics.node.gain), offset = tick - dynamics.originTick;
        gain.cancelAndHoldAtTime(time);
        gain.setValueAtTime(gainEnvelopeAt(dynamics.points, offset), time);
        for (const point of dynamics.points) if (point.tick > offset) gain.linearRampToValueAtTime(point.gain, time + (point.tick - offset) * tickSeconds);
        dynamics.tickSeconds = tickSeconds;
      }
      const glide = voice.glide;
      if (glide && glide.endTick > tick) {
        const glideEndTime = time + (glide.endTick - tick) * tickSeconds;
        if (Math.abs(glideEndTime - glide.endTime) >= 1e-8) {
          const fraction = clamp((tick - glide.startTick) / (glide.endTick - glide.startTick));
          const currentHz = pitchToHz({ millicents: glide.from.millicents + (glide.to.millicents - glide.from.millicents) * fraction });
          voice.sources.forEach((source, i) => {
            automate(source.frequency).cancelAndHoldAtTime(time);
            automate(source.frequency).setValueAtTime(currentHz * glide.ratios[i], time);
            automate(source.frequency).exponentialRampToValueAtTime(pitchToHz(glide.to) * glide.ratios[i], glideEndTime);
          });
          glide.endTime = glideEndTime;
        }
      }
      const end = time + (voice.endTick - tick) * tickSeconds;
      if (Math.abs(end - voice.end) < 1e-8) continue;
      const gain = voice.envelope.gain;
      if (voice.shape === 'additive') {
        automate(gain).cancelAndHoldAtTime(time);
        automate(gain).setValueAtTime(voice.level, end);
        automate(gain).linearRampToValueAtTime(0, end + voice.release);
      } else if (voice.shape === 'melody' || voice.shape === 'detached') {
        const silence = Math.min(end + voice.release, voice.startTime + (voice.shape === 'detached' ? .36 : 1.1));
        // A pluck can naturally decay before its symbolic note-off. A tempo
        // slowdown must not revive an already silent pluck.
        if (silence > time) { automate(gain).cancelAndHoldAtTime(time); automate(gain).exponentialRampToValueAtTime(0.0001, silence); }
      } else {
        automate(gain).cancelAndHoldAtTime(time);
        const attackFinish = Math.max(time, Math.min(voice.attackEndTime ?? time, end - .002));
        if (attackFinish > time) automate(gain).exponentialRampToValueAtTime(Math.max(.0002, voice.level), attackFinish);
        const sustain = voice.level * (voice.articulation === 'sustained' ? .9 : voice.shape === 'bass' ? 0.63 : voice.shape === 'solo' ? 0.76 : 0.52);
        automate(gain).exponentialRampToValueAtTime(Math.max(0.00015, sustain), Math.max(attackFinish + 0.001, end - (voice.shape === 'bass' ? 0.02 : 0.04)));
        automate(gain).exponentialRampToValueAtTime(0.0001, end + voice.release);
      }
      const stop = Math.min(end + voice.release + voice.stopPadding, voice.shape === 'detached' ? voice.startTime + .385 : Infinity);
      for (const source of voice.sources) source.stop(stop);
      voice.end = end;
    }
  }

  note(note: NoteEvent, time: number, duration: number, brightness: number, sound: SoundConfig): void {
    const velocity = Number.isFinite(note.velocity) ? clamp(note.velocity) : 0;
    if (!velocity || !Number.isFinite(time) || time < 0 || !Number.isFinite(duration) || duration <= 0) return;
    if (note.part === 'percussion') { this.percussion(note, time, velocity); return; }
    const pitch = note.absolutePitch ?? (note.midiNote === undefined ? undefined : midiToPitch(note.midiNote));
    if (!pitch) throw new Error('Pitched notes require an absolute pitch.');
    if (sound.instrument === 'additive') { this.additiveNote(note, pitch, time, duration, sound); return; }
    const upper = note.part === 'harmony';
    const bass = note.part === 'bass';
    const solo = note.part === 'melody' && note.voice === 6;
    const counter = note.part === 'melody' && (note.voice === 7 || note.voice === 8);
    const sustained = note.articulation === 'sustained';
    const detached = note.articulation === 'detached' && !(note.endPitch && note.endPitch.millicents !== pitch.millicents);
    const color = note.timbre ?? (upper ? 'keys' : bass ? 'round' : solo ? 'reed' : counter ? 'glass' : 'pluck');
    // Explicit strings and connected reed themes use the same single-line
    // connection model as the solo. Other articulations retain their attacks.
    const singing = note.part === 'melody' && (note.voice === 5 || note.voice === 6) && color === 'strings';
    const connectedTheme = note.part === 'melody' && ['reed', 'flute', 'brass', 'lead', 'strings'].includes(color) && note.articulation === 'connected';
    const legatoLead = solo || singing || connectedTheme;
    const toneKey = `ensemble:${color}`;
    const gliding = Boolean(note.endPitch && note.endPitch.millicents !== pitch.millicents);
    const roll = upper && !gliding && !note.gainEnvelope?.length && note.expression?.role !== 'support' ? Math.min((note.voice % 4) * 0.008 + addressed(note.id, 1) * 0.007, duration * 0.2) : 0;
    const onset = time + roll;
    const end = time + duration;
    const release = detached ? .075 : sustained ? .42 : upper ? 0.36 : bass ? 0.14 : solo ? 0.11 : 0.24;
    // The long lyrical bed shares the lead's color and register. Keep its
    // four inner lines below the explicit singing foreground; this palette
    // balance does not alter legacy colors or the matched additive route.
    const level = velocity * (upper ? color === 'strings' ? .065 : .085 : bass ? .145 : singing ? .16 : solo ? .15 : counter ? .085 : .11);
    const existing = this.upperVoices.get(note.voice);
    if ((upper || legatoLead) && !detached && existing?.articulation !== 'detached' && !gliding && existing && !existing.restCut && existing.endTick >= note.tick && (!existing.glide || existing.glide.endTick <= note.tick) && existing.toneKey === toneKey && (legatoLead || existing.millicents === pitch.millicents) && existing.end > onset - 0.065 && existing.end > this.context.currentTime) {
      const gain = existing.envelope.gain;
      automate(gain).cancelAndHoldAtTime(onset);
      const transition = Math.min(legatoLead ? 0.025 : 0.09, duration * 0.2);
      const structuralAttack = legatoLead && note.expression?.role === 'anchor'
        && (Boolean(note.expression.cueId) || existing.millicents === pitch.millicents);
      const peak = level * (structuralAttack ? 1 : sustained ? .92 : legatoLead ? .88 : .58);
      const body = level * (sustained ? .9 : legatoLead ? .76 : .52);
      automate(gain).linearRampToValueAtTime(peak, onset + transition);
      // Articulate written anchors inside a connected line without dropping
      // its body to silence or exceeding its declared velocity. Settle early
      // and smoothly; the former late step to sustain could click at note-off.
      const settledAt = legatoLead ? Math.max(onset + transition + .001, Math.min(end - .04, onset + transition + .08)) : onset + transition;
      if (legatoLead) automate(gain).exponentialRampToValueAtTime(Math.max(.0001, body), settledAt);
      automate(gain).setValueAtTime(body, Math.max(settledAt, end - 0.04));
      automate(gain).exponentialRampToValueAtTime(0.0001, end + release);
      for (const source of existing.sources) source.stop(end + release + 0.025);
      if (legatoLead && existing.millicents !== pitch.millicents) {
        // Legato joins amplitude, not pitch locations. The oscillator keeps
        // phase continuity at the exact written onset; only an explicit
        // endPitch/glideTicks event authorizes an audible portamento.
        const ratios = ensemblePartials(color, brightness).map(partial => partial[1]);
        existing.sources.forEach((source, i) => {
          automate(source.frequency).cancelAndHoldAtTime(onset);
          automate(source.frequency).setValueAtTime(pitchToHz(pitch) * ratios[i], onset);
        });
        existing.glide = undefined;
        existing.millicents = pitch.millicents;
      }
      existing.end = end; existing.endTick = note.tick + note.duration; existing.level = level; existing.release = release;
      existing.articulation = note.articulation;
      if (legatoLead) existing.attackEndTime = onset + transition;
      // A tied pluck-colored upper voice can become sustained. Subsequent
      // tempo boundaries must retime its new held envelope, not revive the
      // original pluck's already completed natural-decay policy.
      existing.shape = legatoLead ? 'solo' : 'harmony';
      this.startDynamics(existing, note, onset, duration / note.duration, true);
      return;
    }
    if (existing && !existing.restCut && existing.part === note.part && existing.endTick > note.tick && existing.end > onset && (existing.shape !== 'detached' || existing.startTime + .36 > onset)) {
      // A cue or a later sweep may replace a long hold before its written end.
      // Keep one physical line, with a short crossfade and natural FX
      // tails, instead of accumulating old versions of the same voice.
      const fade = Math.min(bass ? .035 : singing || connectedTheme ? .04 : .06, duration * .2, existing.shape === 'detached' ? existing.startTime + .36 - onset : Infinity);
      automate(existing.envelope.gain).cancelAndHoldAtTime(onset);
      automate(existing.envelope.gain).linearRampToValueAtTime(0, onset + fade);
      if (existing.dynamics) automate(existing.dynamics.node.gain).cancelAndHoldAtTime(onset);
      for (const source of existing.sources) source.stop(onset + fade + .005);
      existing.restCut = true; existing.endTick = note.tick; existing.end = onset; existing.release = fade; existing.stopPadding = .005;
    }
    const envelope = this.context.createGain();
    const dynamicGain = this.context.createGain(); dynamicGain.gain.value = 1;
    envelope.connect(dynamicGain);
    const pan = note.voice >= 10 ? [-.62, .38, -.28, .64, -.38][(note.voice - 10) % 5]
      : upper ? [-0.5, -0.17, 0.18, 0.5][clamp(note.voice, 0, 3)] : bass ? 0 : solo ? -0.16 : note.voice === 7 ? 0.42 : note.voice === 8 ? -.42 : 0.1;
    const cleanDynamic = this.connectVoice(dynamicGain, pan, bass ? 0.13 : upper ? 0.8 : solo ? 0.4 : singing ? .6 : counter ? 0.8 : 1);
    const cleanVoice = () => { envelope.disconnect(); cleanDynamic(); };
    const gain = envelope.gain;
    automate(gain).setValueAtTime(0.0001, onset);
    const attack = Math.min(sustained ? .14 + (1 - brightness) * .12 : color === 'strings' ? .09 : color === 'reed' ? .06 : color === 'flute' ? .035 : color === 'brass' ? .025 : color === 'lead' ? .008 : color === 'glass' ? .009 : upper ? .025 : bass ? .014 : .006, (end - onset) * .3);
    automate(gain).exponentialRampToValueAtTime(Math.max(0.0002, level), onset + attack);
    const shape = detached ? 'detached' : legatoLead ? 'solo' : sustained || gliding || upper && note.gainEnvelope?.length ? (bass ? 'bass' : 'harmony') : color === 'pluck' ? 'melody' : bass ? 'bass' : 'harmony';
    if (shape === 'harmony' || shape === 'solo') {
      automate(gain).exponentialRampToValueAtTime(Math.max(0.00015, level * (sustained ? .9 : legatoLead ? 0.76 : 0.52)), Math.max(onset + attack + 0.001, end - 0.04));
      automate(gain).exponentialRampToValueAtTime(0.0001, end + release);
    } else if (shape === 'bass') {
      automate(gain).exponentialRampToValueAtTime(Math.max(0.00015, level * (sustained ? .9 : .63)), Math.max(onset + attack + 0.001, end - 0.02));
      automate(gain).exponentialRampToValueAtTime(0.0001, end + release);
    } else {
      automate(gain).exponentialRampToValueAtTime(Math.max(0.00015, level * 0.2), onset + Math.min(duration * 0.7, detached ? .16 : .4));
      automate(gain).exponentialRampToValueAtTime(0.0001, Math.min(end + release, onset + (detached ? .36 : 1.1)));
    }
    const partials = ensemblePartials(color, brightness);
    let active!: ActiveVoice;
    const sourceEnd = Math.min(end + release + .025, detached ? onset + .385 : Infinity);
    const sources = this.oscillators(onset, sourceEnd, pitchToHz(pitch), envelope, partials, () => { cleanVoice(); this.sustaining.delete(active); });
    active = { millicents: pitch.millicents, toneKey, end, envelope, sources, level,
      startTick: note.tick, endTick: note.tick + note.duration, startTime: onset, release, stopPadding: 0.025,
      shape, articulation: note.articulation, attackEndTime: onset + attack, part: note.part, voice: note.voice, dynamics: { node: dynamicGain, originTick: note.tick, tickSeconds: duration / note.duration } };
    this.startGlide(active, note, pitch, partials.map(partial => partial[1]), duration / note.duration);
    this.startDynamics(active, note, onset, duration / note.duration);
    this.sustaining.add(active);
    this.upperVoices.set(note.voice, active);
  }

  /** The experimental oscillator bank directly shares the model's expansion.
   * No per-part timbre, panning, filter, detune, dynamics compression, or effects
   * alter the relative partial amplitudes. A common envelope/level scales every
   * pitched note; percussion remains outside this static sonority model. */
  private additiveNote(note: NoteEvent, pitch: Pitch, time: number, duration: number, sound: SoundConfig): void {
    const partials = partialsForPitches([pitch], sound.spectrum);
    const toneKey = `additive:${sound.spectrum.partials.map(partial => `${partial.ratio}/${partial.amplitude}`).join(',')}`;
    const end = time + duration, release = 0.08, level = 0.04;
    const existing = note.part === 'harmony' ? this.upperVoices.get(note.voice) : undefined;
    const gliding = Boolean(note.endPitch && note.endPitch.millicents !== pitch.millicents);
    if (!gliding && existing && !existing.restCut && existing.endTick >= note.tick && (!existing.glide || existing.glide.endTick <= note.tick) && existing.toneKey === toneKey && existing.millicents === pitch.millicents && existing.end > time - 0.03 && existing.end > this.context.currentTime) {
      automate(existing.envelope.gain).cancelAndHoldAtTime(time);
      automate(existing.envelope.gain).setValueAtTime(level, time);
      automate(existing.envelope.gain).setValueAtTime(level, end);
      automate(existing.envelope.gain).linearRampToValueAtTime(0, end + release);
      for (const source of existing.sources) source.stop(end + release + 0.01);
      existing.end = end; existing.endTick = note.tick + note.duration;
      return;
    }
    const envelope = this.context.createGain();
    envelope.connect(this.output);
    automate(envelope.gain).setValueAtTime(0, time);
    automate(envelope.gain).linearRampToValueAtTime(level, time + Math.min(0.025, duration * 0.3));
    automate(envelope.gain).setValueAtTime(level, end);
    automate(envelope.gain).linearRampToValueAtTime(0, end + release);
    let active!: ActiveVoice;
    const sources = this.oscillators(time, end + release + 0.01, 1, envelope,
      partials.map(partial => ['sine', partial.frequency, partial.amplitude]), () => { envelope.disconnect(); this.sustaining.delete(active); });
    active = { millicents: pitch.millicents, toneKey, end, envelope, sources, level,
      startTick: note.tick, endTick: note.tick + note.duration, startTime: time, release, stopPadding: 0.01, shape: 'additive', part: note.part, voice: note.voice };
    this.startGlide(active, note, pitch, partials.map(partial => partial.frequency / pitchToHz(pitch)), duration / note.duration);
    this.sustaining.add(active);
    if (note.part === 'harmony') this.upperVoices.set(note.voice, active);
  }

  private percussion(note: NoteEvent, time: number, velocity: number): void {
    const envelope = this.context.createGain();
    const kick = note.midiNote === 35 || note.midiNote === 36;
    const snare = note.midiNote === 38 || note.midiNote === 40;
    const duration = kick ? 0.23 : snare ? 0.18 : 0.09;
    // Noise attacks need their own spectral bandwidth. Their dry signal joins
    // the compressor after the ensemble warmth filter; ambience stays warm.
    // The kick retains its original route, level, and envelope.
    const cleanVoice = this.connectVoice(envelope, kick ? 0 : snare ? -0.1 : 0.25, 0.2, !kick);
    automate(envelope.gain).setValueAtTime(0.0001, time);
    const peak = Math.max(0.0002, velocity * (kick ? 0.17 : snare ? 0.075 : 0.045));
    automate(envelope.gain).exponentialRampToValueAtTime(peak, time + (kick || snare ? 0.003 : 0.0015));
    // Give the noise accents a brief body instead of immediately collapsing
    // from their attack. The kick's envelope and level remain unchanged.
    if (!kick) automate(envelope.gain).exponentialRampToValueAtTime(Math.max(0.00015, peak * (snare ? 0.6 : 0.48)), time + (snare ? 0.025 : 0.012));
    automate(envelope.gain).exponentialRampToValueAtTime(0.0001, time + duration);
    if (kick) {
      let hit!: ActiveHit;
      const oscillator = this.context.createOscillator(); oscillator.type = 'sine';
      automate(oscillator.frequency).setValueAtTime(110, time); automate(oscillator.frequency).exponentialRampToValueAtTime(43, time + 0.12);
      oscillator.connect(envelope); this.attach(oscillator, () => { cleanVoice(); this.hits.delete(hit); });
      oscillator.start(time); oscillator.stop(time + duration + 0.01);
      hit = { startTick: note.tick, end: time + duration + 0.01, source: oscillator, envelope }; this.hits.add(hit);
    } else {
      let hit!: ActiveHit;
      const noise = this.context.createBufferSource(); noise.buffer = this.noise;
      const filter = this.context.createBiquadFilter(); filter.type = snare ? 'bandpass' : 'highpass';
      filter.frequency.value = snare ? 1800 : 4600; filter.Q.value = 0.5;
      const top = this.context.createBiquadFilter(); top.type = 'lowpass'; top.frequency.value = snare ? 9000 : 12000; top.Q.value = 0.5;
      noise.connect(filter); filter.connect(top); top.connect(envelope);
      this.attach(noise, () => { filter.disconnect(); top.disconnect(); cleanVoice(); this.hits.delete(hit); });
      noise.start(time, addressed(note.id, 2) * 0.3); noise.stop(time + duration + 0.01);
      hit = { startTick: note.tick, end: time + duration + 0.01, source: noise, envelope }; this.hits.add(hit);
      if (snare) {
        // A short drum-head component makes the accent perceptible as a hit,
        // not just a quiet burst of filtered air. It decays before the wires.
        const body = this.context.createOscillator(), bodyGain = this.context.createGain();
        body.type = 'sine'; automate(body.frequency).setValueAtTime(190, time); automate(body.frequency).exponentialRampToValueAtTime(145, time + 0.06);
        automate(bodyGain.gain).setValueAtTime(0.4, time); automate(bodyGain.gain).exponentialRampToValueAtTime(0.02, time + 0.085);
        body.connect(bodyGain); bodyGain.connect(envelope);
        let bodyHit!: ActiveHit;
        this.attach(body, () => { bodyGain.disconnect(); this.hits.delete(bodyHit); });
        body.start(time); body.stop(time + 0.1);
        bodyHit = { startTick: note.tick, end: time + 0.1, source: body, envelope }; this.hits.add(bodyHit);
      }
    }
  }

  dispose(): void {
    for (const source of this.sources) { try { source.stop(); } catch { /* Already ended. */ } source.disconnect(); }
    this.sources.clear(); this.upperVoices.clear(); this.sustaining.clear(); this.hits.clear(); this.output.disconnect(); this.analyser.disconnect();
  }
}

export interface AudioPlayerOptions {
  /** Called only when another committed frame is needed, at most 400 ms ahead. */
  nextFrame: () => Frame;
  /** Called when a scheduled frame becomes audible, never at generation time. */
  onFrame: (frame: Frame) => void;
  onStatus?: (playing: boolean) => void;
  /** Background scheduler failures stop the transport and are reported here.
   * Errors while starting play() reject its promise instead. */
  onError?: (error: Error) => void;
}

export interface AudioPlayerDiagnostics {
  playing: boolean;
  interrupted: boolean;
  contextState: AudioContextState | 'absent';
  renderTime: number;
  outputTime: number;
  currentTick: number;
  queuedFrames: number;
  nextFrameTime: number;
  sourceCount: number;
  rms: number;
  peak: number;
  pendingAudioTasks: number;
  lookAheadSeconds: number;
  lastPlanningMs: number;
  maxPlanningMs: number;
  lastSchedulingMs: number;
  maxSchedulingMs: number;
  maxPumpGapMs: number;
  underruns: number;
  lateNoteTasks: number;
  maxLatenessMs: number;
  peakSourceCount: number;
  maxNotesPerPump: number;
}

/** Look-ahead Web Audio transport. pause() suspends the audio clock so resume
 * preserves queued notes and tails. stop() clears audio and transport state;
 * the owner resets its engine before the next play() for exact seed replay.
 */
export class AudioPlayer {
  private context?: AudioContext;
  private rack?: InstrumentRack;
  private timer?: ReturnType<typeof setInterval>;
  private active = false;
  private wantedPlaying = false;
  private disposed = false;
  private browserInterrupted = false;
  private volume = 0.7;
  private nextTime = 0;
  private queue: Array<{ frame: Frame; time: number }> = [];
  private audible?: { frame: Frame; time: number };
  private suspendPending?: Promise<void>;
  private playPending?: Promise<void>;
  private pausedOutputTime?: number;
  private transportRevision = 0;
  private readonly meter = new Float32Array(256);
  private audioTasks: AudioTask[] = [];
  private readonly lookAhead = .4;
  private lastPumpTime?: number;
  private lastPlanningMs = 0; private maxPlanningMs = 0;
  private lastSchedulingMs = 0; private maxSchedulingMs = 0;
  private maxPumpGapMs = 0; private underruns = 0; private lateNoteTasks = 0; private maxLatenessMs = 0;
  private peakSourceCount = 0; private maxNotesPerPump = 0;

  constructor(private readonly options: AudioPlayerOptions) {}
  get playing(): boolean { return this.active; }
  /** True only when the browser/device interrupted an active transport.
   * A user pause is ordinary paused state; play() reconnects the same queue. */
  get interrupted(): boolean { return this.browserInterrupted; }
  get currentTick(): number {
    if (!this.audible || !this.context) return this.queue[0]?.frame.tick ?? 0;
    return this.audible.frame.tick + Math.floor(clamp((this.outputTime(this.context) - this.audible.time) / secondsPerTick(this.audible.frame), 0, this.audible.frame.duration));
  }
  get level(): number {
    if (!this.rack || !this.active) return 0;
    this.rack.analyser.getFloatTimeDomainData(this.meter);
    let sum = 0; for (const sample of this.meter) sum += sample * sample;
    return clamp(Math.sqrt(sum / this.meter.length) * 7);
  }
  /** Read-only transport/signal evidence for the live diagnostic panel. This
   * samples the real analyser; it does not generate frames or alter playback. */
  get diagnostics(): AudioPlayerDiagnostics {
    let sum = 0, peak = 0;
    if (this.rack) {
      this.rack.analyser.getFloatTimeDomainData(this.meter);
      for (const sample of this.meter) { sum += sample * sample; peak = Math.max(peak, Math.abs(sample)); }
    }
    return { playing: this.active, interrupted: this.browserInterrupted, contextState: this.context?.state ?? 'absent',
      renderTime: this.context?.currentTime ?? 0, outputTime: this.context ? this.outputTime(this.context) : 0,
      currentTick: this.currentTick, queuedFrames: this.queue.length, nextFrameTime: this.nextTime,
      sourceCount: this.rack?.sourceCount ?? 0, rms: Math.sqrt(sum / this.meter.length), peak,
      pendingAudioTasks: this.audioTasks.length, lookAheadSeconds: this.lookAhead,
      lastPlanningMs: this.lastPlanningMs, maxPlanningMs: this.maxPlanningMs,
      lastSchedulingMs: this.lastSchedulingMs, maxSchedulingMs: this.maxSchedulingMs,
      maxPumpGapMs: this.maxPumpGapMs, underruns: this.underruns, lateNoteTasks: this.lateNoteTasks,
      maxLatenessMs: this.maxLatenessMs, peakSourceCount: this.peakSourceCount, maxNotesPerPump: this.maxNotesPerPump };
  }

  async play(): Promise<void> {
    if (this.disposed) throw new Error('This audio player has been disposed.');
    // The statechange task can lag a button click after an OS interruption.
    // Reconcile it before an active-state early return would block recovery.
    if (this.active && this.context && this.context.state !== 'running') {
      const closed = this.context.state === 'closed';
      this.contextChanged(this.context);
      if (closed) return;
    }
    if (this.active) return;
    if (this.wantedPlaying && this.playPending) return this.playPending;
    this.wantedPlaying = true;
    const revision = ++this.transportRevision;
    const attempt = this.start(revision);
    this.playPending = attempt;
    try { await attempt; }
    finally { if (this.playPending === attempt) this.playPending = undefined; }
  }

  private async start(revision: number): Promise<void> {
    try {
      if (!this.context) {
        this.context = new AudioContext({ latencyHint: 'interactive' });
        const context = this.context;
        context.onstatechange = () => this.contextChanged(context);
        this.rack = new InstrumentRack(this.context, this.volume);
        this.nextTime = this.context.currentTime + 0.075;
      }
      await this.suspendPending;
      const context = this.context;
      if (!context || revision !== this.transportRevision) return;
      await context.resume();
      if (this.context !== context || this.disposed || revision !== this.transportRevision) {
        if (this.context === context && !this.wantedPlaying && context.state === 'running') this.suspend(context);
        return;
      }
      if (context.state !== 'running') {
        this.active = true;
        this.contextChanged(context);
        return;
      }
      this.pausedOutputTime = undefined;
      this.lastPumpTime = undefined;
      this.browserInterrupted = false;
      this.active = true; this.options.onStatus?.(true);
      if (!this.isCurrent(revision, context)) return;
      this.pump(revision);
      if (!this.isCurrent(revision, context)) return;
      this.timer = setInterval(() => {
        if (!this.isCurrent(revision, context)) return;
        try { this.pump(revision); }
        catch (error) { if (this.isCurrent(revision, context)) this.fail(error); }
      }, 25);
    } catch (error) {
      // Closing an old context while resume() is pending is a successful
      // cancellation, not a failure of the new playback request.
      if (revision !== this.transportRevision) return;
      try { this.stop(); }
      finally { throw error; }
    }
  }

  pause(): void {
    if (this.context) this.pausedOutputTime = this.outputTime(this.context);
    this.transportRevision++;
    this.wantedPlaying = false;
    this.active = false;
    this.browserInterrupted = false;
    if (this.timer !== undefined) clearInterval(this.timer); this.timer = undefined;
    if (this.context?.state === 'running') this.suspend(this.context);
    this.options.onStatus?.(false);
  }

  private suspend(context: AudioContext): void {
    const revision = this.transportRevision;
    this.suspendPending = context.suspend().catch(error => {
      if (this.context === context && revision === this.transportRevision) this.fail(error);
    });
  }

  stop(): void {
    this.transportRevision++;
    this.wantedPlaying = false;
    this.active = false;
    this.browserInterrupted = false;
    if (this.timer !== undefined) clearInterval(this.timer); this.timer = undefined;
    const rack = this.rack; this.rack = undefined;
    const context = this.context; this.context = undefined;
    if (context) context.onstatechange = null;
    const close = () => {
      try { rack?.dispose(); } catch { /* Continue closing even if the device already disposed a node. */ }
      if (context && context.state !== 'closed') {
        try { void context.close().catch(() => { /* A stopped context cannot affect a new transport. */ }); }
        catch { /* A browser can throw synchronously during device teardown. */ }
      }
    };
    if (context?.state === 'running' && rack) {
      try { rack.fadeOut(); setTimeout(close, 25); }
      catch { close(); }
    } else close();
    this.queue = []; this.audioTasks = []; this.audible = undefined; this.nextTime = 0; this.suspendPending = undefined; this.pausedOutputTime = undefined;
    this.lastPumpTime = undefined;
    this.lastPlanningMs = this.maxPlanningMs = this.lastSchedulingMs = this.maxSchedulingMs = 0;
    this.maxPumpGapMs = this.underruns = this.lateNoteTasks = this.maxLatenessMs = this.peakSourceCount = this.maxNotesPerPump = 0;
    this.options.onStatus?.(false);
  }

  setVolume(value: number): void { this.volume = Number.isFinite(value) ? clamp(value) : this.volume; this.rack?.setVolume(this.volume); }
  dispose(): void { this.stop(); this.disposed = true; }

  private isCurrent(revision: number, context: AudioContext): boolean {
    return this.active && !this.disposed && this.transportRevision === revision && this.context === context;
  }

  private contextChanged(context: AudioContext): void {
    if (this.context !== context || this.disposed) return;
    if (context.state === 'closed') {
      this.fail(new Error('The browser closed the audio device. Press Play to reconnect.'));
      return;
    }
    if (context.state === 'running') {
      if (this.browserInterrupted && !this.wantedPlaying) this.suspend(context);
      return;
    }
    if (!this.active) return;
    // External suspension/interruption freezes the existing musical queue.
    // Do not auto-resume: browser policies and device changes may require a
    // fresh user gesture. Explicit pause sets active=false before suspend().
    this.pausedOutputTime = this.outputTime(context);
    this.transportRevision++;
    this.wantedPlaying = false;
    this.active = false;
    this.browserInterrupted = true;
    if (this.timer !== undefined) clearInterval(this.timer); this.timer = undefined;
    this.options.onStatus?.(false);
  }

  private fail(cause: unknown): void {
    const error = cause instanceof Error ? cause : new Error(String(cause));
    try { this.stop(); } catch { /* Cleanup/status errors cannot replace the triggering failure. */ }
    this.options.onError?.(error);
  }

  /** The render clock leads the speakers by the output pipeline's latency.
   * Use the browser's output timestamp where available, otherwise its latency
   * estimate. Scheduling still uses currentTime; only observation uses this. */
  private outputTime(context: AudioContext): number {
    if (this.pausedOutputTime !== undefined) return this.pausedOutputTime;
    if (typeof context.getOutputTimestamp === 'function') {
      const stamp = context.getOutputTimestamp();
      if (Number.isFinite(stamp.contextTime) && Number.isFinite(stamp.performanceTime) && stamp.performanceTime! > 0) {
        return clamp(stamp.contextTime! + Math.max(0, performance.now() - stamp.performanceTime!) / 1000, 0, context.currentTime);
      }
    }
    const latency = (Number.isFinite(context.baseLatency) ? context.baseLatency : 0)
      + (Number.isFinite(context.outputLatency) ? context.outputLatency : 0);
    return Math.max(0, context.currentTime - latency);
  }

  private pump(revision: number): void {
    const context = this.context, rack = this.rack;
    if (!context || !rack || !this.isCurrent(revision, context)) return;
    if (this.lastPumpTime !== undefined) this.maxPumpGapMs = Math.max(this.maxPumpGapMs, (context.currentTime - this.lastPumpTime) * 1000);
    this.lastPumpTime = context.currentTime;
    // Work already committed has priority over DOM callbacks and the next
    // planning pass. Oscillators are allocated near their own onsets instead
    // of constructing an entire dense frame in one burst.
    let lateThisPump = false, notesScheduled = 0;
    const scheduleReady = () => {
      const started = performance.now();
      let processed = 0;
      while (this.audioTasks.length && this.audioTasks[0].time <= context.currentTime + this.lookAhead) {
        // Split a dense score's graph allocation across timer turns while its
        // onsets are still safely in the future. Urgent actions retain order.
        if ((processed >= 24 || performance.now() - started > 6) && this.audioTasks[0].time > context.currentTime + .08) break;
        const task = this.audioTasks.shift()!;
        const lateness = context.currentTime - task.time;
        if (lateness > .005) {
          lateThisPump = true; this.maxLatenessMs = Math.max(this.maxLatenessMs, lateness * 1000);
          if (task.kind === 'note') this.lateNoteTasks++;
        }
        task.run();
        processed++;
        if (task.kind === 'note') notesScheduled++;
      }
      this.lastSchedulingMs += performance.now() - started;
      this.maxSchedulingMs = Math.max(this.maxSchedulingMs, this.lastSchedulingMs);
      this.peakSourceCount = Math.max(this.peakSourceCount, rack.sourceCount);
    };
    this.lastSchedulingMs = 0;
    scheduleReady();
    const audibleNow = this.outputTime(context);
    while (this.queue.length && this.queue[0].time <= audibleNow) {
      this.audible = this.queue.shift()!; this.options.onFrame(this.audible.frame);
      if (!this.isCurrent(revision, context)) return;
    }
    // On browser timer throttling, resume at a clean boundary rather than
    // emitting every missed note at once. No committed musical frames are lost.
    if (this.nextTime < context.currentTime - 0.025) {
      lateThisPump = true; this.maxLatenessMs = Math.max(this.maxLatenessMs, (context.currentTime - this.nextTime) * 1000);
      this.nextTime = context.currentTime + 0.04;
    }
    let generated = 0;
    while (this.nextTime < context.currentTime + this.lookAhead && generated++ < 2) {
      const planningStarted = performance.now();
      const frame = this.options.nextFrame();
      this.lastPlanningMs = performance.now() - planningStarted;
      this.maxPlanningMs = Math.max(this.maxPlanningMs, this.lastPlanningMs);
      if (!this.isCurrent(revision, context)) return;
      if (!Number.isSafeInteger(frame.tick) || frame.tick < 0 || !Number.isSafeInteger(frame.duration) || frame.duration <= 0 || !Number.isFinite(frame.parameters.tempo) || frame.parameters.tempo <= 0) {
        throw new RangeError('The music engine returned an invalid frame time or tempo.');
      }
      const tickSeconds = secondsPerTick(frame);
      // Planning can take longer than the remaining look-ahead. Never queue
      // new notes or claim a section started at an already elapsed timestamp.
      if (this.nextTime < context.currentTime + 0.015) {
        if (this.queue.length || this.audible) {
          lateThisPump = true; this.maxLatenessMs = Math.max(this.maxLatenessMs, Math.max(0, context.currentTime - this.nextTime) * 1000);
        }
        this.nextTime = context.currentTime + 0.04;
      }
      this.audioTasks.push(...rack.frameTasks(frame, this.nextTime));
      this.audioTasks.sort((a, b) => a.time - b.time);
      this.queue.push({ frame, time: this.nextTime });
      this.nextTime += frame.duration * tickSeconds;
      scheduleReady();
    }
    if (lateThisPump) this.underruns++;
    this.maxNotesPerPump = Math.max(this.maxNotesPerPump, notesScheduled);
  }
}

/** Render committed history with the same instrument rack, including tempo
 * changes. Audio samples can vary slightly across browser Web Audio engines;
 * the symbolic notes and their tick addresses remain exactly deterministic.
 */
export async function renderOffline(frames: Frame[], volume = 0.7): Promise<AudioBuffer> {
  const ordered = [...frames].sort((a, b) => a.tick - b.tick);
  if (!ordered.length) throw new Error('Generate some music before rendering audio.');
  const segments: Array<{ tick: number; time: number; seconds: number }> = [];
  let time = 0;
  for (const frame of ordered) {
    const previous = segments.at(-1);
    if (previous) time = previous.time + (frame.tick - previous.tick) * previous.seconds;
    segments.push({ tick: frame.tick, time, seconds: secondsPerTick(frame) });
  }
  const timeAt = (tick: number) => {
    let lo = 0; let hi = segments.length - 1;
    while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (segments[mid].tick <= tick) lo = mid; else hi = mid - 1; }
    const segment = segments[lo]; return segment.time + (tick - segment.tick) * segment.seconds;
  };
  let finalTick = ordered.at(-1)!.tick + ordered.at(-1)!.duration;
  for (const frame of ordered) for (const note of frame.notes) if (Number.isFinite(note.tick) && Number.isFinite(note.duration) && note.duration > 0) finalTick = Math.max(finalTick, note.tick + note.duration);
  const context = new OfflineAudioContext(2, Math.ceil((timeAt(finalTick) + 3) * 44100), 44100);
  const rack = new InstrumentRack(context, clamp(volume));
  for (const frame of ordered) {
    rack.scheduleFrame(frame, timeAt(frame.tick));
  }
  return context.startRendering();
}

/** Interleaved, little-endian 16-bit PCM WAV. */
export function encodeWav(buffer: AudioBuffer): Uint8Array {
  const channels = buffer.numberOfChannels;
  const bytes = new Uint8Array(44 + buffer.length * channels * 2);
  const view = new DataView(bytes.buffer);
  const writeText = (offset: number, text: string) => { for (let i = 0; i < text.length; i++) bytes[offset + i] = text.charCodeAt(i); };
  writeText(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); writeText(8, 'WAVE'); writeText(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true); view.setUint32(28, buffer.sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true); view.setUint16(34, 16, true); writeText(36, 'data'); view.setUint32(40, bytes.length - 44, true);
  const channelData = Array.from({ length: channels }, (_, channel) => buffer.getChannelData(channel));
  let offset = 44;
  for (let i = 0; i < buffer.length; i++) for (let channel = 0; channel < channels; channel++) {
    const sample = clamp(channelData[channel][i], -1, 1);
    view.setInt16(offset, Math.round(sample * (sample < 0 ? 32768 : 32767)), true); offset += 2;
  }
  return bytes;
}
