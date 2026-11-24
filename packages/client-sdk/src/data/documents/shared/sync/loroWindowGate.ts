/**
 * Which scopes of one lifetime may hold a Loro read window at once (#3194).
 * A death counts toward a window only while it is the lifetime's only open
 * one, so a scope isolating the updates a death left holds the gate alone:
 * otherwise a killer that always runs beside another scope's page would
 * never be read alone, and never counted. Other scopes share it.
 *
 * The gate is for progress only. Whether a window counts is decided in the
 * transaction that writes it (`openDocumentSyncLoroWindow`), so a waiter
 * that gives up and reads outside the gate costs progress, never accuracy.
 */

export interface LoroGateWaiter {
  readonly exclusive: boolean;
  readonly scope: string;
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
  /** `scope` asks to hold the gate, alone when `exclusive`. */
  | { readonly type: "requested"; readonly waiter: LoroGateWaiter }
  /** `scope` closed its window, or stopped waiting for the gate. */
  | { readonly type: "released"; readonly scope: string };

export const LORO_WINDOW_GATE_IDLE: LoroWindowGate = {
  status: "idle",
  waiting: [],
};

/** The scopes holding the gate. */
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
      next = { status: "exclusive", holder: head.scope, waiting: rest };
    } else {
      const holders = next.status === "shared" ? next.holders : [];
      next = {
        status: "shared",
        holders: [...holders, head.scope],
        waiting: rest,
      };
    }
  }
}

function withoutScope(gate: LoroWindowGate, scope: string): LoroWindowGate {
  const waiting = gate.waiting.filter((waiter) => waiter.scope !== scope);
  switch (gate.status) {
    case "idle":
      return { status: "idle", waiting };
    case "shared": {
      const holders = gate.holders.filter((holder) => holder !== scope);
      return holders.length === 0
        ? { status: "idle", waiting }
        : { status: "shared", holders, waiting };
    }
    case "exclusive":
      return gate.holder === scope
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
      const { scope } = event.waiter;
      const queued = gate.waiting.some((waiter) => waiter.scope === scope);
      if (loroGateHolders(gate).includes(scope) || queued) return gate;
      return admit({ ...gate, waiting: [...gate.waiting, event.waiter] });
    }
    case "released":
      return admit(withoutScope(gate, event.scope));
  }
}
