import type { WorkerLike } from "./client";
import { requestMethod, responseOutcome } from "./crossTabProtocol";
import { DATABASE_TRANSACTION_REVOKED_MESSAGE } from "./types";
import { DatabaseTransactionRevokedError } from "./workerCrash";

type EventListenerTarget = Pick<
  WorkerLike,
  "addEventListener" | "removeEventListener"
>;

interface SharedWorkerSource extends Partial<EventListenerTarget> {
  readonly port: WorkerLike & { start?: () => void; close(): void };
}

// The worker's answer when it revoked this connection's transaction, if
// `event` carries one.
function revokedRefusal(event: Event): string | null {
  if (!(event instanceof MessageEvent)) {
    return null;
  }
  const outcome = responseOutcome(event.data);
  return outcome?.message?.startsWith(DATABASE_TRANSACTION_REVOKED_MESSAGE)
    ? outcome.message
    : null;
}

/**
 * A SharedWorker's port as the worker client's transport. When the worker
 * revokes this connection's transaction it retires the connection (see
 * `transactionLease.ts`), so its first revoked answer after an `init` is also
 * raised as an error event carrying a `DatabaseTransactionRevokedError`: the
 * client fails every request it has outstanding, and the host's worker-error
 * listeners open the database again, as the cross-tab coordinator does for its
 * clients.
 */
export function portFromModuleSharedWorker(
  sharedWorker: SharedWorkerSource,
): WorkerLike & { close(): void } {
  const { port } = sharedWorker;
  const errorListeners = new Set<(event: Event) => void>();
  let revocationRaised = false;
  // Registered before the client's own listener, so the error fails the
  // revoked request together with the rest.
  port.addEventListener("message", (event) => {
    const refusal = revokedRefusal(event);
    if (refusal === null || revocationRaised) {
      return;
    }
    revocationRaised = true;
    const error = new DatabaseTransactionRevokedError(refusal);
    const errorEvent = new ErrorEvent("error", {
      error,
      message: error.message,
    });
    for (const listener of [...errorListeners]) {
      listener(errorEvent);
    }
  });
  port.start?.();

  return {
    postMessage(message) {
      if (requestMethod(message) === "init") {
        revocationRaised = false;
      }
      port.postMessage(message);
    },
    addEventListener(type, listener) {
      if (type === "error") {
        errorListeners.add(listener);
        if (sharedWorker.addEventListener) {
          sharedWorker.addEventListener(type, listener);
          return;
        }
      }
      port.addEventListener(type, listener);
    },
    removeEventListener(type, listener) {
      if (type === "error") {
        errorListeners.delete(listener);
        if (sharedWorker.removeEventListener) {
          sharedWorker.removeEventListener(type, listener);
          return;
        }
      }
      port.removeEventListener(type, listener);
    },
    close() {
      port.close();
    },
  };
}
