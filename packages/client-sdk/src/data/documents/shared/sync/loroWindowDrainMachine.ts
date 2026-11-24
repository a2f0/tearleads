/**
 * Whether a lifetime admits Loro read windows while its realm prepares to
 * restart (#3194). A drain admits none until the open ones close or its
 * wait ends; the realm then restarts at once, so admitting none for a
 * while longer (the hold) leaves no window open at the restart. A realm its
 * host kept running admits windows again once the hold ends.
 */
export type LoroWindowDrain =
  /** Windows enter through the gate as they ask. */
  | { readonly status: "open" }
  /** Admits none until the open windows close, or wait `drain` ends. */
  | { readonly status: "draining"; readonly drain: number }
  /**
   * Drained, `drained` false when the wait ended with a window open: admits
   * none until hold `drain` ends.
   */
  | {
      readonly status: "holding";
      readonly drain: number;
      readonly drained: boolean;
    };

export type LoroWindowDrainEvent =
  /** The realm asked to restart, as drain `drain`. */
  | {
      readonly type: "drainRequested";
      readonly drain: number;
      readonly openWindows: number;
    }
  /** The last open window closed. */
  | { readonly type: "windowsClosed" }
  /** Drain `drain`'s wait ended. */
  | { readonly type: "waitEnded"; readonly drain: number }
  /** Drain `drain`'s hold ended. */
  | { readonly type: "holdEnded"; readonly drain: number };

export const LORO_WINDOW_DRAIN_OPEN: LoroWindowDrain = { status: "open" };

export function transitionLoroWindowDrain(
  current: LoroWindowDrain,
  event: LoroWindowDrainEvent,
): LoroWindowDrain {
  switch (event.type) {
    case "drainRequested":
      // One drain at a time; a request while holding holds afresh, or
      // drains again a window that entered outside the gate meanwhile.
      if (current.status === "draining") return current;
      return event.openWindows === 0
        ? { drain: event.drain, drained: true, status: "holding" }
        : { drain: event.drain, status: "draining" };
    case "windowsClosed":
      return current.status === "draining"
        ? { drain: current.drain, drained: true, status: "holding" }
        : current;
    case "waitEnded":
      return current.status === "draining" && current.drain === event.drain
        ? { drain: current.drain, drained: false, status: "holding" }
        : current;
    case "holdEnded":
      return current.status === "holding" && current.drain === event.drain
        ? LORO_WINDOW_DRAIN_OPEN
        : current;
  }
}
