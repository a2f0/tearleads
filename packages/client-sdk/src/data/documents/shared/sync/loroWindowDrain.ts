import {
  LORO_WINDOW_DRAIN_OPEN,
  type LoroWindowDrain,
  type LoroWindowDrainEvent,
  transitionLoroWindowDrain,
} from "./loroWindowDrainMachine";
import type { LoroGateWaiter } from "./loroWindowGate";

/** How long a drained realm admits no window, for its restart to begin. */
export const RESTART_HOLD_MS = 5_000;

/** What a drain needs of its lifetime's windows and their gate. */
export interface LoroWindowDrainHost {
  readonly openWindows: () => number;
  /** Takes every request queued at the gate out of it, in queue order. */
  readonly takeQueued: () => LoroGateWaiter[];
  /** Asks the gate again for a request the drain held. */
  readonly readmit: (waiter: LoroGateWaiter) => void;
  /** Hears that a hold ended in a realm its host kept running. */
  readonly reopened: () => void;
  readonly holdMs: number;
}

export interface LoroWindowDrainer {
  /** Holds `waiter` while a drain or its hold stands; false otherwise. */
  hold(waiter: LoroGateWaiter): boolean;
  /** Forgets a held request that stopped waiting for the gate. */
  drop(window: string): void;
  /** Starts or joins a drain; resolves true when it left no window open. */
  drain(waitMs: number): Promise<boolean>;
  /** Notes that a window closed. */
  noteClosed(): void;
}

/**
 * Runs the drain machine (`transitionLoroWindowDrain`): entering `draining`
 * takes the gate's queue and starts the wait, entering `holding` settles
 * the drain and starts the hold, and entering `open` asks the gate again
 * for every held request, in order, then tells the host. Timers carry their drain's tag, so a
 * stale one changes nothing.
 */
export function createLoroWindowDrainer(
  host: LoroWindowDrainHost,
): LoroWindowDrainer {
  let state: LoroWindowDrain = LORO_WINDOW_DRAIN_OPEN;
  let drains = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let settled = Promise.withResolvers<boolean>();
  const held: LoroGateWaiter[] = [];

  const move = (event: LoroWindowDrainEvent, waitMs = 0) => {
    const before = state;
    state = transitionLoroWindowDrain(state, event);
    if (state === before) return;
    clearTimeout(timer);
    switch (state.status) {
      case "draining": {
        const { drain } = state;
        held.push(...host.takeQueued());
        settled = Promise.withResolvers<boolean>();
        timer = setTimeout(() => move({ drain, type: "waitEnded" }), waitMs);
        return;
      }
      case "holding": {
        const { drain } = state;
        if (before.status !== "draining") {
          settled = Promise.withResolvers<boolean>();
        }
        settled.resolve(state.drained);
        timer = setTimeout(
          () => move({ drain, type: "holdEnded" }),
          host.holdMs,
        );
        return;
      }
      case "open":
        for (const waiter of held.splice(0)) host.readmit(waiter);
        host.reopened();
        return;
    }
  };

  return {
    hold(waiter) {
      if (state.status === "open") return false;
      held.push(waiter);
      return true;
    },
    drop(window) {
      const at = held.findIndex((waiter) => waiter.window === window);
      if (at >= 0) held.splice(at, 1);
    },
    drain(waitMs) {
      move(
        {
          drain: ++drains,
          openWindows: host.openWindows(),
          type: "drainRequested",
        },
        waitMs,
      );
      return settled.promise;
    },
    noteClosed() {
      if (host.openWindows() === 0) move({ type: "windowsClosed" });
    },
  };
}
