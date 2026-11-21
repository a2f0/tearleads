import { responseOutcome } from "./crossTabProtocol";
import { DATABASE_NOT_INITIALIZED_MESSAGE } from "./types";

/**
 * Where one tab-local client's open database lives, as its coordinator sees it.
 *
 * The SQLite worker keeps a client's open database on that client's own
 * connection, so the database exists only in the owner worker that answered
 * the client's `init`. When ownership moves to another tab's worker, the
 * client's later statements reach a connection with no database, and the
 * worker answers every one with "Database has not been initialized." while the
 * host still believes it is ready. This machine lets the coordinator notice
 * that and retire the client instead.
 *
 * - `unbound`: no database is open for the client yet.
 * - `bound`: an `init` succeeded, and the owner worker that answered it holds
 *   the client's open database.
 * - `closing`: the client sent `close` or `delete`, so it is being retired.
 *   A missing database is the expected end of its last statements racing the
 *   teardown, and the client no longer needs an owner.
 * - `lost`: the client's database went away with the owner that held it.
 *   Terminal: the host must open a new client. The coordinator answers this
 *   one's requests itself, so they never reach an owner that did not open its
 *   database.
 *
 * A database another connection deleted is not lost: the worker answers that
 * it was deleted, which is no event here, so a deliberate delete (logout,
 * destroying an identity) is never reopened behind the tab that made it.
 */
export type CrossTabConnectionState =
  | { readonly status: "unbound" }
  | { readonly status: "bound" }
  | { readonly status: "closing" }
  | { readonly status: "lost" };

export type CrossTabConnectionEvent =
  // An `init` succeeded.
  | { readonly type: "opened" }
  // The client sent a `close` or `delete`.
  | { readonly type: "closeRequested" }
  // A worker answered that the client's connection has no open database.
  | { readonly type: "databaseMissing" }
  // The owner worker that served this tab is gone: this tab took the owner
  // lock from it, or the owner worker crashed.
  | { readonly type: "ownerGone" };

export const UNBOUND_CONNECTION: CrossTabConnectionState = {
  status: "unbound",
};
const BOUND_CONNECTION: CrossTabConnectionState = { status: "bound" };
const CLOSING_CONNECTION: CrossTabConnectionState = { status: "closing" };
const LOST_CONNECTION: CrossTabConnectionState = { status: "lost" };

function transitionOpenConnection(
  state: CrossTabConnectionState,
  event: CrossTabConnectionEvent,
): CrossTabConnectionState {
  switch (event.type) {
    case "opened":
      return BOUND_CONNECTION;
    case "closeRequested":
      return CLOSING_CONNECTION;
    case "databaseMissing":
    case "ownerGone":
      return state.status === "bound" ? LOST_CONNECTION : state;
  }
}

export function transitionCrossTabConnection(
  state: CrossTabConnectionState,
  event: CrossTabConnectionEvent,
): CrossTabConnectionState {
  switch (state.status) {
    case "lost":
      return state;
    case "closing":
      // Its requests to a vanished owner can never be answered; fail them as
      // lost so the teardown does not wait on them, or retry them elsewhere.
      return event.type === "ownerGone" ? LOST_CONNECTION : state;
    case "unbound":
    case "bound":
      return transitionOpenConnection(state, event);
  }
}

/** Whether the client still needs an owner to serve it. */
export function isOpenCrossTabConnection(
  state: CrossTabConnectionState,
): boolean {
  return state.status === "unbound" || state.status === "bound";
}

/** The event a request implies for the client sending it, if any. */
export function connectionEventForRequest(
  method: string | null,
): CrossTabConnectionEvent | null {
  return method === "close" || method === "delete"
    ? { type: "closeRequested" }
    : null;
}

/** The event a worker response implies for the client that sent `method`. */
export function connectionEventForResponse(
  method: string | null,
  response: unknown,
): CrossTabConnectionEvent | null {
  const outcome = responseOutcome(response);
  if (!outcome) {
    return null;
  }

  if (outcome.ok) {
    return method === "init" ? { type: "opened" } : null;
  }

  return outcome.message === DATABASE_NOT_INITIALIZED_MESSAGE
    ? { type: "databaseMissing" }
    : null;
}
