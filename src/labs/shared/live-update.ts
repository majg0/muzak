/** Coalesce live edits without queuing obsolete worker pipelines. The caller
 * checks isCurrent after each await, before continuing or displaying a result. */
export function createLiveUpdate<T>(options: {
  run(input: T, isCurrent: () => boolean): Promise<void>;
  onError(error: unknown): void;
}) {
  let revision = 0, running = false, disposed = false;
  let queued: { input: T; revision: number; ready: boolean } | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function invalidate(): void {
    revision++;
    queued = undefined;
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  }

  function pump(): void {
    if (disposed || running || !queued?.ready) return;
    const job = queued;
    queued = undefined;
    running = true;
    const isCurrent = () => !disposed && revision === job.revision;
    void (async () => {
      try { await options.run(job.input, isCurrent); }
      catch (error) { if (isCurrent()) options.onError(error); }
      finally { running = false; pump(); }
    })().catch(error => { console.error('Could not report live update error.', error); });
  }

  return {
    request(input: T, delayMs = 0): void {
      if (disposed) return;
      invalidate();
      const job = { input, revision, ready: delayMs <= 0 };
      queued = job;
      if (!job.ready) timer = setTimeout(() => {
        timer = undefined;
        job.ready = true;
        pump();
      }, delayMs);
      pump();
    },
    invalidate,
    dispose(): void { disposed = true; invalidate(); },
  };
}
