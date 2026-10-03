import { runScoreCodec, runSceneEdit, runAuthoredScene } from './codec-jobs';
import { loadCore } from '../core/runtime';
import type { CodecWorkerMessage, CodecWorkerRequest } from './codec-controller';

const port = self as unknown as {
  onmessage: ((event: {data: CodecWorkerRequest}) => void) | null;
  postMessage(message: CodecWorkerMessage): void;
};
let started = false;
port.onmessage = ({data}) => {
  if (started) return;
  started = true;
  void (async () => {
    try {
      const core = await loadCore();
      const options: Parameters<typeof runScoreCodec>[2] = {call: async (op, input) => core.call({op, input} as Parameters<typeof core.call>[0]).output,
        emit: message => port.postMessage(message)};
      if (data.kind === 'source') await runScoreCodec(data.score, data.revision, options);
      else if (data.kind === 'program') await runAuthoredScene(data.scene, data.revision, options);
      else await runSceneEdit(data.score, data.scene, data.edit, data.revision, options);
    } catch (error) { port.postMessage({kind: 'error', revision: data.revision, error: error instanceof Error ? error.message : String(error)}); }
  })();
};
