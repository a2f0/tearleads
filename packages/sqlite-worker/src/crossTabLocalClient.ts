import {
  type CrossTabConnectionState,
  connectionEventForResponse,
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
import { DatabaseWorkerCrashError } from "./workerCrash";

/**
 * One logical client of this tab's coordinator: the synthetic worker handed to a
 * runtime, its liveness lock, the bookkeeping for requests it has posted to
 * a remote owner tab, and where its open database lives.
 */
export interface LocalClient {
  closing: boolean;
  connection: CrossTabConnectionState;
  readonly dispatch: (response: unknown) => void;
  readonly dispatchError: (error: DatabaseWorkerCrashError) => void;
  readonly liveness: ClientLivenessLock;
  // The method of every request still awaiting its response, so a response
  // can say whether it opened or closed the client's database.
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
    closing: false,
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

/**
 * The failure a client sees once its open database is gone. It is a crash: the
 * host retires the runtime and opens a new one, exactly as when the worker
 * itself dies, and the message keeps database-unavailable classifiers matching.
 */
export function databaseConnectionLostError(): DatabaseWorkerCrashError {
  return new DatabaseWorkerCrashError({
    message:
      "The database connection was lost: the tab that owned it closed, or another connection deleted the database. Open the database again.",
  });
}

/** Note what a request will do to the client before it is routed. */
export function admitLocalClientRequest(
  localClient: LocalClient,
  request: unknown,
): void {
  const id = requestId(request);
  const method = requestMethod(request);
  if (method === "close" || method === "delete") {
    localClient.closing = true;
  }
  if (id !== null && method !== null) {
    localClient.methodsByRequestId.set(id, method);
  }
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

  const event = connectionEventForResponse({
    closing: localClient.closing,
    method,
    response,
  });
  if (event) {
    const previous = localClient.connection;
    localClient.connection = transitionCrossTabConnection(previous, event);
    if (
      previous.status !== "lost" &&
      localClient.connection.status === "lost"
    ) {
      // This answer and every other outstanding request fail as one loss.
      crashLocalClient(localClient, databaseConnectionLostError());
      return;
    }
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

  localClient.connection = transitionCrossTabConnection(
    localClient.connection,
    { type: "ownerGone" },
  );
  crashLocalClient(localClient, error);
}

/**
 * This tab just took the owner lock, so the owner it had been routing to is
 * gone. A client with a database open there has lost it; any other client only
 * loses the requests it had posted there, which fail with a retryable error
 * rather than waiting out the timeout.
 */
export function releaseLocalClientFromPreviousOwner(
  localClient: LocalClient,
): void {
  if (localClient.connection.status === "bound") {
    dispatchCrashToLocalClient(localClient, databaseConnectionLostError());
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
