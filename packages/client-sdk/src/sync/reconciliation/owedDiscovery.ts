import type { ReconcilePriority } from "./queue";
import type { ReconciliationHost } from "./serviceTypes";

/**
 * Queues the containers whose document lanes an earlier session left owed. A
 * start with a cached tree emits no hint for them: without this, a lane whose
 * listing a reload cut short is never listed again. `isCurrent` is captured
 * when the lookup starts, so a stopped or restarted reconciler drops it.
 */
export function resumeOwedDocumentDiscovery(input: {
  readonly enqueue: (containerId: string, priority: ReconcilePriority) => void;
  readonly host: ReconciliationHost;
  readonly isCurrent: () => boolean;
}): void {
  const { enqueue, host, isCurrent } = input;
  void host
    .listOwedDocumentDiscoveryContainerIds(host.listKnownContainerIds())
    .then(
      (containerIds) => {
        if (!isCurrent()) return;
        for (const containerId of containerIds) enqueue(containerId, "idle");
      },
      (error: unknown) => {
        if (!isCurrent() || host.isIgnorableError(error)) return;
        return host.logError?.(
          "Reconciliation: owed discovery lookup failed",
          error,
        );
      },
    );
}
