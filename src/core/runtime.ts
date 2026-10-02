import init, { execute_json } from './wasm/muzak_core.js';
import type { CoreRequest } from './generated/CoreRequest';
import type { CoreResponse } from './generated/CoreResponse';
import type { CoreReply } from './generated/CoreReply';
export type { CoreRequest, CoreResponse };
export type CoreOperation = CoreRequest['op'];
export type CoreInput<Op extends CoreOperation> = Extract<CoreRequest, { op: Op }>['input'];
export type CoreOutput<Op extends CoreOperation> = Extract<CoreResponse, { op: Op }>['output'];
export class RustCoreError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = 'RustCoreError'; }
}
export interface CoreRuntime { call(request: CoreRequest): CoreResponse }
let loading: Promise<CoreRuntime> | undefined;
/** Shared Wasm loader, usable directly inside any existing application worker. */
export function loadCore(): Promise<CoreRuntime> {
  return loading ??= (async () => {
    const url = new URL('./wasm/muzak_core_bg.wasm', import.meta.url);
    if (typeof process !== 'undefined' && process.versions?.node) {
      const moduleName = 'node:fs/promises';
      const { readFile } = await import(/* @vite-ignore */ moduleName);
      await init({ module_or_path: await readFile(url) });
    } else await init({ module_or_path: url });
    return { call(request) {
      // JSON has no nonfinite numeric representation. Reject transport loss
      // rather than silently turning an invalid numeric option into null/default.
      const serialized = JSON.stringify(request, (_key, value) => {
        if (typeof value === 'number' && !Number.isFinite(value)) throw new RustCoreError('invalid-input', 'Invalid input: numbers must be finite.');
        return value;
      });
      const reply = JSON.parse(execute_json(serialized)) as CoreReply;
      if ('error' in reply) throw new RustCoreError(reply.error.code, reply.error.message);
      return reply.response;
    } };
  })();
}
