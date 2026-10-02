import { loadCore, type CoreRequest } from './runtime';
const runtime = loadCore();
self.onmessage = async (event: MessageEvent<{ id: number; request: CoreRequest }>) => {
  const { id, request } = event.data;
  try { self.postMessage({ id, response: (await runtime).call(request) }); }
  catch (error) { self.postMessage({ id, error: { code: (error as { code?: string }).code ?? 'runtime-error', message: error instanceof Error ? error.message : String(error) } }); }
};
