import type { Score } from './score';
import type { MusicalScene } from '../core/generated/MusicalScene';
import type { ScoreComparison } from '../core/generated/ScoreComparison';
import type { CoreRequest } from '../core/generated/CoreRequest';

export interface ScoreCodecResult { source: Score; scene: MusicalScene; decoded: Score; comparison: ScoreComparison }
export type CodecStage = 'encoding' | 'editing' | 'decoding' | 'verifying';
export type SceneEdit = {[Op in 'transposeScene' | 'changeSceneHarmony']: {
  op: Op; input: Omit<Extract<CoreRequest, {op: Op}>['input'], 'scene'>;
}}['transposeScene' | 'changeSceneHarmony'];
export type ScoreCodecSnapshot = {revision: number; status: CodecStage}
  | {revision: number; status: 'ready'; result: ScoreCodecResult}
  | {revision: number; status: 'error'; error: string};
export type CodecWorkerRequest = {kind: 'source'; revision: number; score: Score}
  | {kind: 'program'; revision: number; scene: MusicalScene}
  | {kind: 'edit'; revision: number; score: Score; scene: MusicalScene; edit: SceneEdit};
export type CodecWorkerMessage = {kind: 'stage'; revision: number; stage: CodecStage}
  | {kind: 'ready'; revision: number; result: ScoreCodecResult}
  | {kind: 'error'; revision: number; error: string};
export interface CodecWorkerPort {
  postMessage(message: CodecWorkerRequest): void;
  terminate(): void;
  onmessage: ((event: {data: CodecWorkerMessage}) => void) | null;
  onerror: ((event: {message: string}) => void) | null;
}

/** Immutable observations and an authoritative program. Edits never re-encode. */
export function createScoreCodecController(options: {
  onSnapshot(snapshot: ScoreCodecSnapshot): void;
  workerFactory?: () => CodecWorkerPort;
}) {
  let revision = 0, disposed = false, current: ScoreCodecSnapshot | undefined, worker: CodecWorkerPort | undefined;
  let source: Score | undefined, accepted: ScoreCodecResult | undefined;
  let pending: {resolve(): void; reject(error: Error): void} | undefined;
  const publish = (value: ScoreCodecSnapshot) => { current = value; options.onSnapshot(value); };
  function cancel(): void {
    worker?.terminate(); worker = undefined;
    pending?.reject(new Error('The score changed before the edit completed.')); pending = undefined;
  }
  function fail(ticket: number, error: string): void {
    if (disposed || ticket !== revision || current?.status === 'ready' || current?.status === 'error') return;
    worker?.terminate(); worker = undefined; publish({revision, status: 'error', error});
    pending?.reject(new Error(error)); pending = undefined;
  }
  function start(request: CodecWorkerRequest): void {
    const ticket = request.revision;
    publish({revision, status: request.kind === 'source' ? 'encoding' : request.kind === 'program' ? 'decoding' : 'editing'});
    try {
      worker = options.workerFactory?.() ?? new Worker(new URL('./codec-worker.ts', import.meta.url), {type: 'module'}) as unknown as CodecWorkerPort;
      worker.onmessage = ({data}) => {
        if (disposed || ticket !== revision || data.revision !== revision || current?.status === 'ready' || current?.status === 'error') return;
        if (data.kind === 'error') fail(ticket, data.error);
        else if (data.kind === 'ready') {
          accepted = data.result; source = data.result.source; worker?.terminate(); worker = undefined;
          publish({revision, status: 'ready', result: data.result});
          pending?.resolve(); pending = undefined;
        } else publish({revision, status: data.stage});
      };
      worker.onerror = event => fail(ticket, event.message || 'Musical codec worker failed.');
      worker.postMessage(request);
    } catch (error) { fail(ticket, error instanceof Error ? error.message : String(error)); }
  }
  return {
    setSource(score: Score): number {
      if (disposed) throw new Error('Score codec controller is disposed.');
      cancel(); source = structuredClone(score); accepted = undefined;
      ++revision; start({kind: 'source', revision, score: source});
      return revision;
    },
    setProgram(scene: MusicalScene): number {
      if (disposed) throw new Error('Score codec controller is disposed.');
      cancel();
      ++revision; start({kind: 'program', revision, scene});
      return revision;
    },
    edit(edit: SceneEdit): Promise<void> {
      if (disposed || !source || !accepted) return Promise.reject(new Error('No executable scene is available.'));
      if (worker) return Promise.reject(new Error('Wait for the current scene operation to finish.'));
      ++revision;
      return new Promise((resolve, reject) => {
        pending = {resolve, reject};
        start({kind: 'edit', revision, score: source!, scene: accepted!.scene, edit});
      });
    },
    snapshot: () => current,
    dispose(): void { disposed = true; revision++; cancel(); current = undefined; source = undefined; accepted = undefined; },
  };
}
