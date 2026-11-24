/**
 * Which Loro read windows of one lifetime may be open at once (#3194). A
 * death counts toward a window only while it is the lifetime's only open
 * one, so a window isolating the updates a death left holds the gate alone:
 * otherwise a killer that always runs beside another page would never be
 * read alone, and never counted. Other windows share it.
 *
 * The gate is for progress only. Whether a window counts is decided in the
 * transaction that writes it (`openDocumentSyncLoroWindow`), so a waiter
 * that gives up and reads outside the gate costs progress, never accuracy.
 */

export interface LoroGateWaiter {
  readonly exclusive: boolean;
  readonly window: string;
}

export type LoroWindowGate =
  | { readonly status: "idle"; readonly waiting: readonly LoroGateWaiter[] }
  | {
      readonly status: "shared";
      readonly holders: readonly string[];
      readonly waiting: readonly LoroGateWaiter[];
    }
  | {
      readonly status: "exclusive";
      readonly holder: string;
      readonly waiting: readonly LoroGateWaiter[];
    };

export type LoroWindowGateEvent =
  /** A window asks to hold the gate, alone when `exclusive`. */
  | { readonly type: "requested"; readonly waiter: LoroGateWaiter }
  /** `window` closed, or stopped waiting for the gate. */
  | { readonly type: "released"; readonly window: string };

export const LORO_WINDOW_GATE_IDLE: LoroWindowGate = {
  status: "idle",
  waiting: [],
};

/** The windows holding the gate. */
export function loroGateHolders(gate: LoroWindowGate): readonly string[] {
  switch (gate.status) {
    case "idle":
      return [];
    case "shared":
      return gate.holders;
    case "exclusive":
      return [gate.holder];
  }
}

/** Admits waiters in order while the one at the head may enter. */
function admit(gate: LoroWindowGate): LoroWindowGate {
  let next = gate;
  for (;;) {
    const [head, ...rest] = next.waiting;
    if (!head || next.status === "exclusive") return next;
    if (head.exclusive) {
      if (next.status !== "idle") return next;
      next = { status: "exclusive", holder: head.window, waiting: rest };
    } else {
      const holders = next.status === "shared" ? next.holders : [];
      next = {
        status: "shared",
        holders: [...holders, head.window],
        waiting: rest,
      };
    }
  }
}

function withoutWindow(gate: LoroWindowGate, window: string): LoroWindowGate {
  const waiting = gate.waiting.filter((waiter) => waiter.window !== window);
  switch (gate.status) {
    case "idle":
      return { status: "idle", waiting };
    case "shared": {
      const holders = gate.holders.filter((holder) => holder !== window);
      return holders.length === 0
        ? { status: "idle", waiting }
        : { status: "shared", holders, waiting };
    }
    case "exclusive":
      return gate.holder === window
        ? { status: "idle", waiting }
        : { status: "exclusive", holder: gate.holder, waiting };
  }
}

export function transitionLoroWindowGate(
  gate: LoroWindowGate,
  event: LoroWindowGateEvent,
): LoroWindowGate {
  switch (event.type) {
    case "requested": {
      const { window } = event.waiter;
      const queued = gate.waiting.some((waiter) => waiter.window === window);
      if (loroGateHolders(gate).includes(window) || queued) return gate;
      return admit({ ...gate, waiting: [...gate.waiting, event.waiter] });
    }
    case "released":
      return admit(withoutWindow(gate, event.window));
  }
}
