import type { CoreCall } from '../core/client';

export interface LabContext {
  readonly signal: AbortSignal;
  readonly call: CoreCall;
  /** Register as soon as a resource is acquired, including before any await. */
  onDispose(cleanup: () => void): void;
}

/** A session retains this lab's private draft and accepted results, not live UI. */
export interface LabSession {
  mount(container: HTMLElement, context: LabContext): void | Promise<void>;
}

export interface LabModule { createSession(): LabSession }

/** Static discovery metadata. Importing the catalog never starts an experiment. */
export interface LabDefinition {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly group: string;
  readonly tags: readonly string[];
  readonly load: () => Promise<LabModule>;
}
