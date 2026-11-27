/**
 * Work that the acknowledgement of a server-events connect attempt also does
 * waits for that attempt, so it is not done twice: once before the
 * acknowledgement and once after it. The acknowledgement's work must come
 * after it, because hints sent before an acknowledgement are lost. This one
 * transition decides when the work runs, for every caller:
 *
 * - the tree crawl that regaining sync prerequisites starts
 *   (`connectAttemptGate.ts` in the container store), which yields to the
 *   crawl an acknowledgement owes and is restored when that acknowledgement
 *   is lost before its crawl lists;
 * - the idle backfill of document lanes and the resume of the lanes an
 *   earlier boot left owed (`stores/local-projection/`);
 * - an opened document's startup probe (`startupProbeMachine.ts`).
 *
 * | State | Event | Next | Released |
 * | --- | --- | --- | --- |
 * | none | hold, no attempt pending | none | the request |
 * | none | hold, attempt `a` pending | waiting(a) | nothing |
 * | none | yield | yielded | nothing |
 * | waiting(a) | observe, `a` still pending | unchanged | nothing |
 * | waiting(a) | observe, `a` settled, acknowledged | yielded | nothing |
 * | waiting(a) | observe, `a` ended or replaced, not acknowledged | none | the request |
 * | yielded | covered | none | nothing |
 * | yielded | acknowledgementLost | none | the request |
 * | waiting | reset | none | the request |
 * | yielded | reset | none | nothing |
 *
 * Every other pair leaves the state unchanged and releases nothing. A hold or
 * a yield while a request is waiting or yielded joins that request: the
 * caller settles the new one with it. The caller runs a released request.
 *
 * "Acknowledged" is the caller's: the acknowledgement's work is owed or
 * already done. A caller whose acknowledged work cannot be lost treats
 * `yielded` as done and never sends `covered` or `acknowledgementLost`.
 *
 * Every wait lasts at most one connect attempt, and the host ends an attempt
 * whose ticket request, handshake or acknowledgement times out. An attempt
 * replaced by a retry releases the request instead of waiting on the retry
 * as well, so back-to-back attempts cannot hold it. Nothing here waits on
 * another device.
 */
export type ConnectAttemptWait<Request> =
  | { readonly status: "none" }
  | {
      readonly attempt: number;
      readonly request: Request;
      readonly status: "waiting";
    }
  | { readonly request: Request; readonly status: "yielded" };

/** What a caller sees of the connection when it observes the wait. */
export interface ConnectAttemptObservation {
  /** The acknowledgement's work is owed or done; see the module comment. */
  readonly acknowledged: boolean;
  readonly pendingConnectAttempt: number | undefined;
}

export type ConnectAttemptWaitEvent<Request> =
  | {
      readonly pendingConnectAttempt: number | undefined;
      readonly request: Request;
      readonly type: "hold";
    }
  /** A request superseded while the acknowledged work is owed parks behind it. */
  | { readonly request: Request; readonly type: "yield" }
  | ({ readonly type: "observe" } & ConnectAttemptObservation)
  /** The acknowledged work completed. */
  | { readonly type: "covered" }
  /** The acknowledged work can no longer run before a new acknowledgement. */
  | { readonly type: "acknowledgementLost" }
  | { readonly type: "reset" };

export interface ConnectAttemptWaitTransition<Request> {
  /** The request to run now, if any. */
  readonly released: Request | undefined;
  readonly state: ConnectAttemptWait<Request>;
}

export const NO_CONNECT_ATTEMPT_WAIT: ConnectAttemptWait<never> = {
  status: "none",
};

function stay<Request>(
  state: ConnectAttemptWait<Request>,
): ConnectAttemptWaitTransition<Request> {
  return { released: undefined, state };
}

function release<Request>(
  request: Request,
): ConnectAttemptWaitTransition<Request> {
  return { released: request, state: NO_CONNECT_ATTEMPT_WAIT };
}

function observe<Request>(
  state: ConnectAttemptWait<Request>,
  event: ConnectAttemptObservation,
): ConnectAttemptWaitTransition<Request> {
  if (state.status !== "waiting") return stay(state);
  if (event.pendingConnectAttempt === state.attempt) return stay(state);
  return event.acknowledged
    ? stay({ request: state.request, status: "yielded" })
    : release(state.request);
}

export function transitionConnectAttemptWait<Request>(
  state: ConnectAttemptWait<Request>,
  event: ConnectAttemptWaitEvent<Request>,
): ConnectAttemptWaitTransition<Request> {
  switch (event.type) {
    case "hold":
      if (state.status !== "none") return stay(state);
      return event.pendingConnectAttempt === undefined
        ? release(event.request)
        : stay({
            attempt: event.pendingConnectAttempt,
            request: event.request,
            status: "waiting",
          });
    case "yield":
      return state.status === "none"
        ? stay({ request: event.request, status: "yielded" })
        : stay(state);
    case "observe":
      return observe(state, event);
    case "covered":
      return state.status === "yielded"
        ? stay(NO_CONNECT_ATTEMPT_WAIT)
        : stay(state);
    case "acknowledgementLost":
      return state.status === "yielded" ? release(state.request) : stay(state);
    case "reset":
      return state.status === "waiting"
        ? release(state.request)
        : stay(NO_CONNECT_ATTEMPT_WAIT);
    default: {
      const unhandled: never = event;
      return unhandled;
    }
  }
}
