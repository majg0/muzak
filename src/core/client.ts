import { loadCore, RustCoreError, type CoreInput, type CoreOperation, type CoreOutput, type CoreRequest, type CoreResponse } from './runtime';
let worker: Worker | undefined, nextId = 1;
const pending = new Map<number, { resolve(value: CoreResponse): void; reject(error: Error): void }>();
export const core = {
  async call(request: CoreRequest): Promise<CoreResponse> {
    if (typeof Worker === 'undefined') return (await loadCore()).call(request);
    if (!worker) {
      worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = event => {
        const { id, response, error } = event.data, request = pending.get(id); if (!request) return;
        pending.delete(id);
        if (error) request.reject(new RustCoreError(error.code, error.message)); else request.resolve(response);
      };
      worker.onerror = event => { for (const request of pending.values()) request.reject(new Error(event.message)); pending.clear(); worker?.terminate(); worker = undefined; };
    }
    const id = nextId++;
    return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); worker!.postMessage({ id, request }); });
  },
};
export async function callCore<Op extends CoreOperation>(op: Op, input: CoreInput<Op>): Promise<CoreOutput<Op>> {
  const response = await core.call({ op, input } as CoreRequest);
  if (response.op !== op) throw new Error('Rust core returned a mismatched operation.');
  return response.output as CoreOutput<Op>;
}
