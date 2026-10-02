import { loadCore, type CoreInput, type CoreOperation, type CoreOutput, type CoreRequest } from './runtime';
const runtime = await loadCore();
/** Transport facade for mechanism tests/native scripts; no TypeScript fallback. */
export function callCoreSync<Op extends CoreOperation>(op: Op, input: CoreInput<Op>): CoreOutput<Op> {
  const response = runtime.call({ op, input } as CoreRequest);
  if (response.op !== op) throw new Error('Rust core returned a mismatched operation.');
  return response.output as CoreOutput<Op>;
}
