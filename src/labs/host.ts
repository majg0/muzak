import { createLabScope, type LabScope } from './scope';
import type { LabDefinition, LabSession } from './types';

export type LabStatus = {phase: 'idle'} | {phase: 'loading' | 'ready'; id: string}
  | {phase: 'error'; id: string; message: string};

export interface LabHostOptions {
  definitions: readonly LabDefinition[];
  createContainer(): HTMLElement;
  show(container?: HTMLElement): void;
  changed(status: LabStatus): void;
  createScope?(): LabScope;
}

/** One active mount; cached sessions contain only each module's private data. */
export function createLabHost(options: LabHostOptions) {
  const definitions = new Map<string, LabDefinition>(), sessions = new Map<string, LabSession>();
  for (const definition of options.definitions) {
    if (!/^[a-z][a-z0-9-]*$/.test(definition.id) || definitions.has(definition.id)) {
      throw new Error(`Invalid or duplicate lab ID: ${definition.id}`);
    }
    definitions.set(definition.id, definition);
  }
  let revision = 0, disposed = false;
  let active: {id: string; scope: LabScope} | undefined;
  const message = (error: unknown) => error instanceof Error ? error.message : String(error);
  function release(): void {
    const previous = active; active = undefined;
    if (previous) previous.scope.dispose();
  }
  return {
    async open(id: string): Promise<void> {
      if (disposed) throw new Error('The lab host is disposed.');
      const definition = definitions.get(id);
      if (!definition) throw new Error(`Unknown lab: ${id}`);
      const ticket = ++revision;
      try { release(); }
      catch (error) { options.show(); options.changed({phase: 'error', id, message: message(error)}); return; }
      const scope = options.createScope?.() ?? createLabScope();
      const container = options.createContainer();
      active = {id, scope}; options.show(container); options.changed({phase: 'loading', id});
      const current = () => !disposed && ticket === revision && !scope.signal.aborted;
      try {
        let session = sessions.get(id);
        if (!session) {
          const module = await definition.load();
          if (!current()) return;
          session = module.createSession(); sessions.set(id, session);
        }
        await session.mount(container, scope);
        if (current()) options.changed({phase: 'ready', id});
      } catch (error) {
        if (!current()) return;
        try { release(); } catch { /* Report the original mount failure. */ }
        options.show(); options.changed({phase: 'error', id, message: message(error)});
      }
    },
    close(): void {
      revision++;
      try { release(); }
      finally { options.show(); options.changed({phase: 'idle'}); }
    },
    dispose(): void {
      if (disposed) return;
      disposed = true; revision++;
      try { release(); }
      finally { sessions.clear(); options.show(); }
    },
  };
}
