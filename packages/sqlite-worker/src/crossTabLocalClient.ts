import {
  type ClientLivenessLock,
  createClientLivenessLock,
} from "./crossTabLocks";
import { errorResponse, responseId } from "./crossTabProtocol";
import type { DatabaseWorkerCrashError } from "./workerCrash";

/**
 * One logical client of this tab's coordinator: the synthetic worker handed to a
 * runtime, its liveness lock, and the bookkeeping for requests it has posted to
 * a remote owner tab.
 */
export interface LocalClient {
  closing: boolean;
  readonly dispatch: (response: unknown) => void;
  readonly dispatchError: (error: DatabaseWorkerCrashError) => void;
  readonly liveness: ClientLivenessLock;
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
    timeoutsByRequestId: new Map(),
    pendingRemoteRequestIds: new Set(),
  };
}

export function dispatchResponseToLocalClient(
  localClient: LocalClient,
  response: unknown,
): void {
  const id = responseId(response);
  if (id !== null) {
    const timeoutId = localClient.timeoutsByRequestId.get(id);
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
      localClient.timeoutsByRequestId.delete(id);
    }
    localClient.pendingRemoteRequestIds.delete(id);
  }

  localClient.dispatch(response);
}

// Every request this client has outstanding — routed locally or posted to a
// remote owner — is lost with the crashed worker, so drop their timeouts too:
// the client rejects them all at once and would only ignore the late errors.
export function dispatchCrashToLocalClient(
  localClient: LocalClient,
  error: DatabaseWorkerCrashError,
): void {
  for (const timeoutId of localClient.timeoutsByRequestId.values()) {
    clearTimeout(timeoutId);
  }
  localClient.timeoutsByRequestId.clear();
  localClient.pendingRemoteRequestIds.clear();
  localClient.dispatchError(error);
}

/**
 * Fail every still-outstanding remote request of this client with a retryable
 * error. Called when this tab is promoted to owner, because the owner it had
 * posted those requests to is now gone.
 */
export function failPendingRemoteRequests(localClient: LocalClient): void {
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
