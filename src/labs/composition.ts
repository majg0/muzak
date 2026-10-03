import { mountScoreWorkbench, type WorkbenchState } from '../score/workbench';
import type { LabSession } from './types';

export function createSession(): LabSession {
  let state: WorkbenchState | undefined;
  return {
    mount(container, context) {
      const workbench = mountScoreWorkbench(container, state, context.call);
      context.onDispose(() => {
        state = workbench.snapshot();
        workbench.dispose();
      });
    },
  };
}
