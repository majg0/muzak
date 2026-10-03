import { createCoreClient } from '../core/client';
import type { LabContext } from './types';

export interface LabScope extends LabContext { dispose(): void }

/** Each activation gets its own cancellable worker, listeners and resources. */
export function createLabScope(): LabScope {
  const abort = new AbortController(), core = createCoreClient();
  const cleanups: Array<() => void> = [];
  let disposed = false;
  return {
    signal: abort.signal,
    call: core.call,
    onDispose(cleanup) { if (disposed) cleanup(); else cleanups.push(cleanup); },
    dispose() {
      if (disposed) return;
      disposed = true; abort.abort();
      const errors: unknown[] = [];
      for (const cleanup of cleanups.reverse()) {
        try { cleanup(); } catch (error) { errors.push(error); }
      }
      cleanups.length = 0; core.dispose();
      if (errors.length) throw new AggregateError(errors, 'Could not release every lab resource.');
    },
  };
}
