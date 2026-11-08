import type { ReconciliationHost } from "./serviceTypes";

export type RefreshScope = "root" | "full";

/**
 * One refresh every joining caller shares. A caller that passes a signal can
 * withdraw: its own promise rejects at once with the signal's reason. The
 * refresh itself stops, at its next safe boundary, only once every caller has
 * withdrawn, so a caller without a signal (the reconnect catch-up, an
 * organization-membership refresh) always keeps it running. A refresh whose
 * callers all withdrew before it began never starts.
 */
export class SharedRefresh {
  readonly promise: Promise<void>;
  readonly scope: RefreshScope;
  /** Set once the refresh begins; a fresh-listing request queues behind it. */
  started = false;
  private readonly stopController = new AbortController();
  private waiters = 0;

  constructor(input: {
    /** A refresh this one queues behind; its failure never prevents this one. */
    readonly after: Promise<void> | undefined;
    readonly onSettled: (refresh: SharedRefresh) => void;
    readonly run: (stop: AbortSignal) => Promise<void>;
    readonly scope: RefreshScope;
  }) {
    this.scope = input.scope;
    const stop = this.stopController.signal;
    this.promise = (input.after ?? Promise.resolve())
      .catch(() => undefined)
      .then(() => {
        if (stop.aborted) return;
        this.started = true;
        return input.run(stop);
      })
      .finally(() => input.onSettled(this));
  }

  /** True once every caller withdrew; a new caller must not join it. */
  get stopping(): boolean {
    return this.stopController.signal.aborted;
  }

  /** Adds one caller; `signal` lets that caller withdraw. */
  join(signal: AbortSignal | undefined): Promise<void> {
    this.waiters += 1;
    if (!signal) return this.promise;
    return new Promise<void>((resolve, reject) => {
      const withdraw = () => {
        this.waiters -= 1;
        if (this.waiters === 0) this.stopController.abort();
        reject(signal.reason);
      };
      signal.addEventListener("abort", withdraw, { once: true });
      this.promise.then(
        () => {
          signal.removeEventListener("abort", withdraw);
          resolve();
        },
        (error: unknown) => {
          signal.removeEventListener("abort", withdraw);
          reject(error);
        },
      );
    });
  }
}

/**
 * Settles with `work`, or as soon as `stop` aborts. A stop ends only the wait:
 * the work may be shared, so it keeps running, and its later outcome is
 * consumed so a rejection is never unhandled.
 */
function settleUnlessStopped(
  work: Promise<void>,
  stop: AbortSignal,
): Promise<void> {
  if (stop.aborted) {
    work.catch(() => undefined);
    return Promise.resolve();
  }
  return new Promise<void>((resolve, reject) => {
    const abandon = () => resolve();
    stop.addEventListener("abort", abandon, { once: true });
    work.then(
      () => {
        stop.removeEventListener("abort", abandon);
        resolve();
      },
      (error: unknown) => {
        stop.removeEventListener("abort", abandon);
        reject(error);
      },
    );
  });
}

/**
 * Runs the tree refresh and returns its failure instead of throwing it, so
 * the known containers are still swept; a lost database still throws. A stop
 * ends only the wait: the store's tree crawl may be shared, so it runs on.
 */
export async function refreshTreeForSweep(
  host: Pick<ReconciliationHost, "isIgnorableError">,
  refreshTree: () => Promise<void>,
  stop: AbortSignal,
): Promise<unknown> {
  try {
    await settleUnlessStopped(refreshTree(), stop);
    return undefined;
  } catch (error) {
    if (host.isIgnorableError(error)) throw error;
    return error;
  }
}
