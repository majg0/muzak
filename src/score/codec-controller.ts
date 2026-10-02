import type { Score } from './score';
import type { MusicalScene } from '../core/generated/MusicalScene';
import type { ScoreComparison } from '../core/generated/ScoreComparison';

export interface ScoreCodecResult { scene: MusicalScene; decoded: Score; comparison: ScoreComparison }
export type CodecStage = 'encoding' | 'decoding' | 'verifying';
export type ScoreCodecSnapshot = {revision: number; status: CodecStage}
  | {revision: number; status: 'ready'; result: ScoreCodecResult}
  | {revision: number; status: 'error'; error: string};
export type CodecWorkerRequest = {kind: 'source'; revision: number; score: Score};
export type CodecWorkerMessage = {kind: 'stage'; revision: number; stage: CodecStage}
  | {kind: 'ready'; revision: number; result: ScoreCodecResult}
  | {kind: 'error'; revision: number; error: string};
export interface CodecWorkerPort {
  postMessage(message: CodecWorkerRequest): void;
  terminate(): void;
  onmessage: ((event: {data: CodecWorkerMessage}) => void) | null;
  onerror: ((event: {message: string}) => void) | null;
}

/** One source, one cancellable codec run. Navigation is deliberately absent. */
export function createScoreCodecController(options: {
  onSnapshot(snapshot: ScoreCodecSnapshot): void;
  workerFactory?: () => CodecWorkerPort;
}) {
  let revision = 0, disposed = false, current: ScoreCodecSnapshot | undefined, worker: CodecWorkerPort | undefined;
  const publish = (value: ScoreCodecSnapshot) => { current = value; options.onSnapshot(value); };
  function fail(ticket: number, error: string): void {
    if (disposed || ticket !== revision || current?.status === 'ready' || current?.status === 'error') return;
    worker?.terminate(); worker = undefined; publish({revision, status: 'error', error});
  }
  return {
    setSource(score: Score): number {
      if (disposed) throw new Error('Score codec controller is disposed.');
      worker?.terminate(); worker = undefined;
      const ticket = ++revision; publish({revision, status: 'encoding'});
      try {
        worker = options.workerFactory?.() ?? new Worker(new URL('./codec-worker.ts', import.meta.url), {type: 'module'}) as unknown as CodecWorkerPort;
        worker.onmessage = ({data}) => {
          if (disposed || ticket !== revision || data.revision !== revision || current?.status === 'ready' || current?.status === 'error') return;
          if (data.kind === 'error') fail(ticket, data.error);
          else if (data.kind === 'ready') { publish({revision, status: 'ready', result: data.result}); worker?.terminate(); worker = undefined; }
          else publish({revision, status: data.stage});
        };
        worker.onerror = event => fail(ticket, event.message || 'Musical codec worker failed.');
        worker.postMessage({kind: 'source', revision, score});
      } catch (error) { fail(ticket, error instanceof Error ? error.message : String(error)); }
      return revision;
    },
    snapshot: () => current,
    dispose(): void { disposed = true; revision++; worker?.terminate(); worker = undefined; current = undefined; },
  };
}
