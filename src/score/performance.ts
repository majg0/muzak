import { callCoreSync } from '../core/sync';
import type { Score } from './score';
import type { TempoPoint } from '../core/generated/TempoPoint';
import type { PerformanceOptions } from '../core/generated/PerformanceOptions';
export type { TempoPoint } from '../core/generated/TempoPoint';
export type { AutomationPoint } from '../core/generated/AutomationPoint';
export type { PerformedNote } from '../core/generated/PerformedNote';
export type { CompiledPerformance } from '../core/generated/CompiledPerformance';
export type { PerformanceOptions } from '../core/generated/PerformanceOptions';
export function tempoMap(score: Score) { return callCoreSync('tempoMap', { score }); }
export function tickToSeconds(tick: number, ppq: number, tempos: TempoPoint[]) { return callCoreSync('tickToSeconds', { tick, ppq, tempos }); }
export function secondsToTick(seconds: number, ppq: number, tempos: TempoPoint[]) { return callCoreSync('secondsToTick', { seconds, ppq, tempos }); }
export function compilePerformance(score: Score, options: PerformanceOptions = {}) { return callCoreSync('compilePerformance', { score, options }); }
