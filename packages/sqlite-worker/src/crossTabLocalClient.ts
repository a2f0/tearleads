import {
  type CrossTabConnectionEvent,
  type CrossTabConnectionState,
  connectionEventForRequest,
  connectionEventForResponse,
  isOpenCrossTabConnection,
  transitionCrossTabConnection,
  UNBOUND_CONNECTION,
} from "./crossTabConnectionMachine";
import {
  type ClientLivenessLock,
  createClientLivenessLock,
} from "./crossTabLocks";
import {
  errorResponse,
  requestId,
  requestMethod,
  responseId,
} from "./crossTabProtocol";
import {
  DatabaseConnectionLostError,
  type DatabaseWorkerCrashError,
} from "./workerCrash";

/**
 * One logical client of this tab's coordinator: the synthetic worker handed to a
 * runtime, its liveness lock, the bookkeeping for requests it has posted to
 * a remote owner tab, and where its open database lives.
 */
export interface LocalClient {
  connection: CrossTabConnectionState;
  readonly dispatch: (response: unknown) => void;
  readonly dispatchError: (error: DatabaseWorkerCrashError) => void;
  readonly liveness: ClientLivenessLock;
  // The method of every request still awaiting its response, so a response
  // can say whether it opened the client's database.
  readonly methodsByRequestId: Map<number, string>;
  readonly timeoutsByRequestId: Map<number, ReturnType<typeof setTimeout>>;
  // Request ids this client posted over BroadcastChannel that have not yet been
  // answered by the owner tab. Used to fail them fast (rather than wait out the
  // timeout) when this tab is promoted to owner after the previous owner died.
  readonly pendingRemoteRequestIds: Set<number>;
}

export function createLocalClient(
  clientId: string,
  events: EventTarget,
): LocalClient {
  return {
    connection: UNBOUND_CONNECTION,
    dispatch: (response) => {
      events.dispatchEvent(new MessageEvent("message", { data: response }));
    },
    // Carries the instance so the client's error handler rejects with the
    // stack minted where the crash was observed, not one rooted here.
    dispatchError: (error) => {
      events.dispatchEvent(
        new ErrorEvent("error", { error, message: error.message }),
      );
    },
    liveness: createClientLivenessLock(clientId),
    methodsByRequestId: new Map(),
    timeoutsByRequestId: new Map(),
    pendingRemoteRequestIds: new Set(),
  };
}

// Apply an event; true when it just made the client lost.
function applyConnectionEvent(
  localClient: LocalClient,
  event: CrossTabConnectionEvent | null,
): boolean {
  if (!event) {
    return false;
  }

  const previous = localClient.connection;
  localClient.connection = transitionCrossTabConnection(previous, event);
  return previous.status !== "lost" && localClient.connection.status === "lost";
}

/**
 * Note what a request will do to the client before it is routed. A lost
 * client needs no owner, so its requests fail here instead of waiting for one.
 */
export function admitLocalClientRequest(
  localClient: LocalClient,
  request: unknown,
): void {
  assertLocalClientConnected(localClient);
  const id = requestId(request);
  const method = requestMethod(request);
  applyConnectionEvent(localClient, connectionEventForRequest(method));
  if (id !== null && method !== null) {
    localClient.methodsByRequestId.set(id, method);
  }
}

/**
 * No owner holds a lost client's database, so its requests fail here rather
 * than reach one that would answer as if the database had never been opened.
 */
export function assertLocalClientConnected(localClient: LocalClient): void {
  if (localClient.connection.status === "lost") {
    throw new DatabaseConnectionLostError();
  }
}

/** Whether the client still needs an owner to serve it. */
export function isOpenLocalClient(localClient: LocalClient): boolean {
  return isOpenCrossTabConnection(localClient.connection);
}

// Every request this client has outstanding — routed locally or posted to a
// remote owner — is lost with the crashed worker, so drop their timeouts too:
// the client rejects them all at once and would only ignore the late errors.
function crashLocalClient(
  localClient: LocalClient,
  error: DatabaseWorkerCrashError,
): void {
  for (const timeoutId of localClient.timeoutsByRequestId.values()) {
    clearTimeout(timeoutId);
  }
  localClient.timeoutsByRequestId.clear();
  localClient.pendingRemoteRequestIds.clear();
  localClient.methodsByRequestId.clear();
  localClient.dispatchError(error);
}

export function dispatchResponseToLocalClient(
  localClient: LocalClient,
  response: unknown,
): void {
  const id = responseId(response);
  let method: string | null = null;
  if (id !== null) {
    const timeoutId = localClient.timeoutsByRequestId.get(id);
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
      localClient.timeoutsByRequestId.delete(id);
    }
    localClient.pendingRemoteRequestIds.delete(id);
    method = localClient.methodsByRequestId.get(id) ?? null;
    localClient.methodsByRequestId.delete(id);
  }

  const event = connectionEventForResponse(method, response);
  if (applyConnectionEvent(localClient, event)) {
    // This answer and every other outstanding request fail as one loss.
    crashLocalClient(localClient, new DatabaseConnectionLostError());
    return;
  }

  localClient.dispatch(response);
}

// The worker serving this client died, so a database it had open died with
// it. A client already lost was told so when it was lost.
export function dispatchCrashToLocalClient(
  localClient: LocalClient,
  error: DatabaseWorkerCrashError,
): void {
  if (localClient.connection.status === "lost") {
    return;
  }

  applyConnectionEvent(localClient, { type: "ownerGone" });
  crashLocalClient(localClient, error);
}

/**
 * This tab just took the owner lock, so the owner it had been routing to is
 * gone. A client with a database open there, or retiring from it, has lost it;
 * any other client only loses the requests it had posted there, which fail
 * with a retryable error rather than waiting out the timeout.
 */
export function releaseLocalClientFromPreviousOwner(
  localClient: LocalClient,
): void {
  if (applyConnectionEvent(localClient, { type: "ownerGone" })) {
    crashLocalClient(localClient, new DatabaseConnectionLostError());
    return;
  }

  for (const id of [...localClient.pendingRemoteRequestIds]) {
    dispatchResponseToLocalClient(
      localClient,
      errorResponse(id, "The database owner tab changed; retry the request."),
    );
  }
}

export function releaseLocalClient(localClient: LocalClient): void {
  for (const timeoutId of localClient.timeoutsByRequestId.values()) {
    clearTimeout(timeoutId);
  }
  localClient.liveness.release();
}
