// The server events connection as an explicit state machine: one closed union
// of states and one pure transition. serverEventsConnectionLoop runs the
// effects (ticket requests, sockets, timers) on entering and leaving states.
//
// Every connect attempt has a number. Events from an attempt carry it, and only
// the attempt the state is in may advance it, so a late ticket, socket event, or
// timer from an earlier attempt never moves a newer one.

export type ServerEventsConnectionState =
  | { readonly status: "idle" }
  | { readonly status: "requesting-ticket"; readonly attempt: number }
  | {
      readonly status: "opening";
      readonly attempt: number;
      readonly socket: WebSocket;
    }
  | {
      readonly status: "open";
      readonly attempt: number;
      readonly openedAtMs: number;
      readonly socket: WebSocket;
    }
  /** Waiting for the reconnect timer after `attempt` ended. */
  | { readonly status: "backoff"; readonly attempt: number }
  | { readonly status: "stopped" };

export type ServerEventsConnectionEvent =
  | { readonly type: "start" }
  /** The attempt ended before a socket was bound (no ticket, no socket). */
  | { readonly type: "attempt-failed"; readonly attempt: number }
  | {
      readonly type: "socket-bound";
      readonly attempt: number;
      readonly socket: WebSocket;
    }
  | {
      readonly type: "socket-opened";
      readonly attempt: number;
      readonly atMs: number;
    }
  /** The socket closed, errored, or its opening handshake timed out. */
  | { readonly type: "socket-closed"; readonly attempt: number }
  /** The reconnect timer for `attempt` fired. */
  | { readonly type: "retry"; readonly attempt: number }
  | { readonly type: "stop" };

export const SERVER_EVENTS_IDLE: ServerEventsConnectionState = {
  status: "idle",
};

/** The socket of the state, when the state owns one. */
export function connectionSocket(
  state: ServerEventsConnectionState,
): WebSocket | null {
  return state.status === "opening" || state.status === "open"
    ? state.socket
    : null;
}

type AttemptStatus = Exclude<
  ServerEventsConnectionState["status"],
  "idle" | "stopped"
>;

/** Whether the state is one of `statuses` for exactly this attempt. */
function inAttempt<S extends AttemptStatus>(
  state: ServerEventsConnectionState,
  attempt: number,
  ...statuses: ReadonlyArray<S>
): state is Extract<ServerEventsConnectionState, { status: S }> {
  return (
    "attempt" in state &&
    state.attempt === attempt &&
    statuses.some((status) => status === state.status)
  );
}

/** Pure transition; returns the same reference for an ignored event. */
export function transitionServerEventsConnection(
  state: ServerEventsConnectionState,
  event: ServerEventsConnectionEvent,
): ServerEventsConnectionState {
  switch (event.type) {
    case "start":
      return state.status === "idle"
        ? { attempt: 1, status: "requesting-ticket" }
        : state;
    case "attempt-failed":
      return inAttempt(state, event.attempt, "requesting-ticket")
        ? { attempt: event.attempt, status: "backoff" }
        : state;
    case "socket-bound":
      return inAttempt(state, event.attempt, "requesting-ticket")
        ? { attempt: event.attempt, socket: event.socket, status: "opening" }
        : state;
    case "socket-opened":
      return inAttempt(state, event.attempt, "opening")
        ? {
            attempt: event.attempt,
            openedAtMs: event.atMs,
            socket: state.socket,
            status: "open",
          }
        : state;
    case "socket-closed":
      return inAttempt(state, event.attempt, "opening", "open")
        ? { attempt: event.attempt, status: "backoff" }
        : state;
    case "retry":
      return inAttempt(state, event.attempt, "backoff")
        ? { attempt: event.attempt + 1, status: "requesting-ticket" }
        : state;
    case "stop":
      return state.status === "stopped" ? state : { status: "stopped" };
    default:
      return assertNever(event);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled server events value: ${JSON.stringify(value)}`);
}
