import { loadCore, RustCoreError, type CoreInput, type CoreOperation, type CoreOutput, type CoreRequest, type CoreResponse } from './runtime';

export type CoreCall = <Op extends CoreOperation>(op: Op, input: CoreInput<Op>) => Promise<CoreOutput<Op>>;
export interface CoreClient { call: CoreCall; dispose(): void }
export interface CoreWorkerRequest { id: number; request: CoreRequest }
export type CoreWorkerMessage = { id: number; response: CoreResponse }
  | { id: number; error: { code: string; message: string } };
export interface CoreWorkerPort {
  postMessage(message: CoreWorkerRequest): void;
  terminate(): void;
  onmessage: ((event: { data: CoreWorkerMessage }) => void) | null;
  onerror: ((event: { message: string }) => void) | null;
}

/** A caller owns its worker and pending requests. Disposing a lab can therefore
 * cancel its computations without interrupting another caller. */
export function createCoreClient(options: { workerFactory?: () => CoreWorkerPort } = {}): CoreClient {
  let worker: CoreWorkerPort | undefined, nextId = 1, disposed = false;
  const pending = new Map<number, { resolve(value: CoreResponse): void; reject(error: Error): void }>();
  const asError = (error: unknown) => error instanceof Error ? error : new Error(String(error));
  function rejectAll(error: Error): void {
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  }
  function finish(id: number, response: CoreResponse): void {
    const request = pending.get(id); if (!request) return;
    pending.delete(id); request.resolve(response);
  }
  function fail(id: number, error: unknown): void {
    const request = pending.get(id); if (!request) return;
    pending.delete(id); request.reject(asError(error));
  }
  function dispatch(request: CoreRequest): Promise<CoreResponse> {
    if (disposed) return Promise.reject(new Error('Rust core client is disposed.'));
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      // Native tests and callers without Worker use the same Rust runtime. The
      // pending entry still makes disposal immediate during asynchronous loading.
      if (!options.workerFactory && typeof Worker === 'undefined') {
        void loadCore().then(runtime => {
          if (disposed || !pending.has(id)) return;
          try { finish(id, runtime.call(request)); } catch (error) { fail(id, error); }
        }, error => fail(id, error));
        return;
      }
      try {
        if (!worker) {
          const created = options.workerFactory?.()
            ?? new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }) as unknown as CoreWorkerPort;
          worker = created;
          created.onmessage = ({ data }) => {
            if (disposed || worker !== created) return;
            if ('error' in data) fail(data.id, new RustCoreError(data.error.code, data.error.message));
            else finish(data.id, data.response);
          };
          created.onerror = event => {
            if (disposed || worker !== created) return;
            worker = undefined; created.terminate();
            rejectAll(new Error(event.message || 'Rust core worker failed.'));
          };
        }
        worker.postMessage({ id, request });
      } catch (error) { fail(id, error); }
    });
  }
  return {
    async call<Op extends CoreOperation>(op: Op, input: CoreInput<Op>): Promise<CoreOutput<Op>> {
      const response = await dispatch({ op, input } as CoreRequest);
      if (response.op !== op) throw new Error('Rust core returned a mismatched operation.');
      return response.output as CoreOutput<Op>;
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      worker?.terminate(); worker = undefined;
      rejectAll(new Error('Rust core client is disposed.'));
    },
  };
}

/** Shared caller for adapters outside a mounted lab. Labs inject their own client. */
export const callCore: CoreCall = createCoreClient().call;
