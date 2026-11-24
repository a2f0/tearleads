import { type LoroLifetimes, processLoroLifetimes } from "./loroLifetime";
import {
  LORO_RUNTIME_HEALTHY,
  type LoroRuntimeHealth,
  type LoroRuntimeHealthEvent,
  transitionLoroRuntimeHealth,
} from "./loroRuntimeHealthMachine";

/**
 * How long a restart waits for the realm's open read windows to close. A
 * window left open is claimed by the next lifetime as one that ended while
 * hidden (a reload hides the page first), so it counts nothing.
 */
const DRAIN_WAIT_MS = 10_000;

/** The realm's runtime health and its restart. */
export interface LoroRuntimeHealthMonitor {
  current(): LoroRuntimeHealth;
  /** Calls `listener` on every change; returns its removal. */
  subscribe(listener: () => void): () => void;
  /** Notes a Loro runtime failure anywhere in the realm. */
  noteRuntimeFailed(): void;
  /**
   * Drains the realm's read windows for a restart and resolves once the host
   * may restart. It never rejects; a request while one drains joins it.
   */
  prepareRestart(): Promise<void>;
}

export function createLoroRuntimeHealth(input: {
  readonly lifetimes: Pick<LoroLifetimes, "drainWindows">;
  /** @internal How long a drain waits; tests shorten it. */
  readonly drainWaitMs?: number | undefined;
}): LoroRuntimeHealthMonitor {
  let health = LORO_RUNTIME_HEALTHY;
  let drains = 0;
  let draining: Promise<void> | null = null;
  const listeners = new Set<() => void>();
  const move = (event: LoroRuntimeHealthEvent) => {
    const next = transitionLoroRuntimeHealth(health, event);
    if (next === health) return;
    health = next;
    for (const listener of [...listeners]) listener();
  };
  return {
    current: () => health,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    noteRuntimeFailed: () => move({ type: "runtimeFailed" }),
    prepareRestart() {
      if (health.status === "draining" && draining) return draining;
      drains += 1;
      const drain = drains;
      // The promise stands before listeners hear `draining`, so one that
      // asks again joins this drain; its end runs only after this returns.
      draining = input.lifetimes
        .drainWindows(input.drainWaitMs ?? DRAIN_WAIT_MS)
        .catch(() => false)
        .then(() => move({ drain, type: "windowsDrained" }));
      move({ drain, type: "restartRequested" });
      return draining;
    },
  };
}

/** This realm's runtime health; tests create their own. */
export const processLoroRuntimeHealth: LoroRuntimeHealthMonitor =
  createLoroRuntimeHealth({ lifetimes: processLoroLifetimes });
