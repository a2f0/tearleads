import { responseOutcome } from "./crossTabProtocol";
import { DATABASE_NOT_INITIALIZED_MESSAGE } from "./types";

/**
 * Where one tab-local client's open database lives, as its coordinator sees it.
 *
 * The SQLite worker keeps a client's open database on that client's own
 * connection, so the database exists only in the owner worker that answered
 * the client's `init`. When ownership moves to another tab's worker, or another
 * connection deletes the database, the client's later statements reach a
 * connection with no database, and the worker answers every one with "Database
 * has not been initialized." while the host still believes it is ready. This
 * machine lets the coordinator notice that and retire the client instead.
 *
 * - `unbound`: no database is open for the client: before its `init`, or after
 *   its `close` or `delete` succeeded.
 * - `bound`: an `init` succeeded, and the owner worker that answered it holds
 *   the client's open database.
 * - `lost`: that database is gone. Terminal: the host must open a new client.
 *   The coordinator answers this one's requests itself, so they never reach an
 *   owner that did not open its database.
 */
export type CrossTabConnectionState =
  | { readonly status: "unbound" }
  | { readonly status: "bound" }
  | { readonly status: "lost" };

export type CrossTabConnectionEvent =
  // An `init` succeeded.
  | { readonly type: "opened" }
  // A `close` or `delete` succeeded.
  | { readonly type: "closed" }
  // A worker answered that the client's connection has no open database.
  | { readonly type: "databaseMissing" }
  // The owner worker that served this tab is gone: this tab took the owner
  // lock from it, or its own owner worker crashed.
  | { readonly type: "ownerGone" };

export const UNBOUND_CONNECTION: CrossTabConnectionState = {
  status: "unbound",
};
const BOUND_CONNECTION: CrossTabConnectionState = { status: "bound" };
const LOST_CONNECTION: CrossTabConnectionState = { status: "lost" };

export function transitionCrossTabConnection(
  state: CrossTabConnectionState,
  event: CrossTabConnectionEvent,
): CrossTabConnectionState {
  if (state.status === "lost") {
    return state;
  }

  switch (event.type) {
    case "opened":
      return BOUND_CONNECTION;
    case "closed":
      return UNBOUND_CONNECTION;
    case "databaseMissing":
    case "ownerGone":
      return state.status === "bound" ? LOST_CONNECTION : state;
  }
}

/**
 * The event a worker response implies for the client that sent `method`, if
 * any. A missing database while the client is tearing down is the expected
 * end of a `close` racing its last statements, not a loss.
 */
export function connectionEventForResponse(input: {
  readonly closing: boolean;
  readonly method: string | null;
  readonly response: unknown;
}): CrossTabConnectionEvent | null {
  const outcome = responseOutcome(input.response);
  if (!outcome) {
    return null;
  }

  if (outcome.ok) {
    if (input.method === "init") {
      return { type: "opened" };
    }
    return input.method === "close" || input.method === "delete"
      ? { type: "closed" }
      : null;
  }

  return !input.closing && outcome.message === DATABASE_NOT_INITIALIZED_MESSAGE
    ? { type: "databaseMissing" }
    : null;
}
