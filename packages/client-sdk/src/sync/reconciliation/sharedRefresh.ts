import type { ReconciliationHost } from "./serviceTypes";
import {
  QUEUED_SHARED_REFRESH,
  type SharedRefreshEvent,
  type SharedRefreshState,
  transitionSharedRefresh,
} from "./sharedRefreshMachine";

export type RefreshScope = "root" | "full";

/**
 * One refresh every joining caller shares; see `sharedRefreshMachine.ts` for
 * its lifecycle. A caller that passes a signal can withdraw: its own promise
 * rejects at once with the signal's reason. Entering `stopping` aborts the
 * signal the running refresh checks at its safe boundaries.
 */
export class SharedRefresh {
  readonly promise: Promise<void>;
  readonly scope: RefreshScope;
  private state: SharedRefreshState = QUEUED_SHARED_REFRESH;
  private readonly stopController = new AbortController();

  constructor(input: {
    /** A refresh this one queues behind; its failure never prevents this one. */
    readonly after: Promise<void> | undefined;
    readonly onSettled: (refresh: SharedRefresh) => void;
    readonly run: (stop: AbortSignal) => Promise<void>;
    readonly scope: RefreshScope;
  }) {
    this.scope = input.scope;
    this.promise = (input.after ?? Promise.resolve())
      .catch(() => undefined)
      .then(() => {
        this.dispatch({ type: "started" });
        if (this.state.status !== "running") return;
        return input.run(this.stopController.signal);
      })
      .finally(() => {
        this.dispatch({ type: "settled" });
        input.onSettled(this);
      });
  }

  /** Running: a fresh-listing request must queue behind it, not join it. */
  get started(): boolean {
    return this.state.status === "running";
  }

  /** Every caller withdrew; a new caller must start a new refresh. */
  get stopping(): boolean {
    return this.state.status === "stopping";
  }

  /** Adds one caller; `signal` lets that caller withdraw. */
  join(signal: AbortSignal | undefined): Promise<void> {
    this.dispatch({ type: "joined" });
    if (!signal) return this.promise;
    return new Promise<void>((resolve, reject) => {
      const withdraw = () => {
        this.dispatch({ type: "withdrew" });
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

  private dispatch(event: SharedRefreshEvent): void {
    const next = transitionSharedRefresh(this.state, event);
    const stops =
      next.status === "stopping" && this.state.status !== "stopping";
    this.state = next;
    if (stops) this.stopController.abort();
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
