/**
 * Which connection may run statements on one open database.
 *
 * Every connection to a database in a worker shares one SQLite handle, so a
 * transaction one connection opens is open for all of them. The lease makes
 * the connection whose statement left the handle inside a transaction its
 * holder: until a statement of its own ends that transaction, only its
 * statements run, and every other connection's statements wait.
 *
 * - `free`: the handle is in autocommit mode; the oldest waiting statement of
 *   any connection runs next.
 * - `held`: `holder`'s statement left a transaction open. `activeAt` is the
 *   later of its last statement arriving and its last statement settling.
 * - `releasing`: the worker is rolling the holder's transaction back, because
 *   the holder closed or sat idle for the bound while another connection
 *   waited. Entering it runs the rollback.
 * - `failed`: the rollback left the handle inside a transaction, so no other
 *   connection can be served safely. Absorbing: the database is closed and
 *   every connection must open it again.
 */
export type TransactionLeaseReleaseCause = "holderClosed" | "holderStalled";

export type TransactionLeaseState<C> =
  | { readonly status: "free" }
  | {
      readonly status: "held";
      readonly holder: C;
      readonly activeAt: number;
    }
  | {
      readonly status: "releasing";
      readonly holder: C;
      readonly cause: TransactionLeaseReleaseCause;
      readonly idleMs: number;
    }
  | { readonly status: "failed" };

export type TransactionLeaseEvent<C> =
  // A statement from `connection` reached the worker.
  | {
      readonly type: "statementArrived";
      readonly connection: C;
      readonly at: number;
    }
  // A statement from `connection` ran, successfully or not, and left the
  // handle in (`autocommit`) or out of autocommit mode.
  | {
      readonly type: "statementSettled";
      readonly connection: C;
      readonly autocommit: boolean;
      readonly at: number;
    }
  // `connection` closed: a `close`, a port disconnect, or the owner's sweep.
  | { readonly type: "holderClosed"; readonly connection: C }
  // The worker's timer asks whether the holder has stalled.
  | {
      readonly type: "idleCheck";
      readonly at: number;
      readonly idleLimitMs: number;
      readonly othersWaiting: boolean;
      readonly holderPending: boolean;
    }
  // The forced rollback finished, leaving the handle in (`autocommit`) or out
  // of autocommit mode.
  | { readonly type: "rolledBack"; readonly autocommit: boolean };

/** How long a statement waits for another connection's lease. */
export const TRANSACTION_LEASE_WAIT_MS = 5_000;

/**
 * How long a holder may send nothing while another connection waits. Below
 * the wait bound, so a waiter behind a holder that stalled runs instead of
 * being refused.
 */
export const TRANSACTION_LEASE_IDLE_MS = 3_000;

export const FREE_TRANSACTION_LEASE: TransactionLeaseState<never> = {
  status: "free",
};
const FAILED_TRANSACTION_LEASE: TransactionLeaseState<never> = {
  status: "failed",
};

function transitionHeldLease<C>(
  state: Extract<TransactionLeaseState<C>, { status: "held" }>,
  event: TransactionLeaseEvent<C>,
): TransactionLeaseState<C> {
  switch (event.type) {
    case "statementArrived":
      return event.connection === state.holder
        ? { ...state, activeAt: Math.max(state.activeAt, event.at) }
        : state;
    case "statementSettled":
      if (event.connection !== state.holder) {
        // Unreachable: no other connection's statement runs while held.
        return state;
      }
      return event.autocommit
        ? FREE_TRANSACTION_LEASE
        : { ...state, activeAt: Math.max(state.activeAt, event.at) };
    case "holderClosed":
      return event.connection === state.holder
        ? {
            status: "releasing",
            holder: state.holder,
            cause: "holderClosed",
            idleMs: 0,
          }
        : state;
    case "idleCheck": {
      const idleMs = event.at - state.activeAt;
      // A holder with a statement already waiting to run is not idle.
      return event.othersWaiting &&
        !event.holderPending &&
        idleMs >= event.idleLimitMs
        ? {
            status: "releasing",
            holder: state.holder,
            cause: "holderStalled",
            idleMs,
          }
        : state;
    }
    case "rolledBack":
      return state;
  }
}

export function transitionTransactionLease<C>(
  state: TransactionLeaseState<C>,
  event: TransactionLeaseEvent<C>,
): TransactionLeaseState<C> {
  switch (state.status) {
    case "free":
      return event.type === "statementSettled" && !event.autocommit
        ? { status: "held", holder: event.connection, activeAt: event.at }
        : state;
    case "held":
      return transitionHeldLease(state, event);
    case "releasing":
      if (event.type !== "rolledBack") {
        return state;
      }
      return event.autocommit
        ? FREE_TRANSACTION_LEASE
        : FAILED_TRANSACTION_LEASE;
    case "failed":
      return state;
  }
}

/** Whether a statement from `connection` may run now. */
export function mayRunUnderTransactionLease<C>(
  state: TransactionLeaseState<C>,
  connection: C,
): boolean {
  return (
    state.status === "free" ||
    (state.status === "held" && state.holder === connection)
  );
}
