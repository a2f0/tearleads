import type { LocalProjectionStore } from "../../stores/local-projection";
import type { ReconciliationService } from "./service";

/**
 * Wire the local projection store's reconcile signals into the background
 * reconciler. Returns an unsubscribe handle. This is the only place Layer A and
 * Layer B are connected: signals in, scheduling out — no React involved.
 */
export function connectReconciliationTriggers(input: {
  store: LocalProjectionStore;
  service: ReconciliationService;
}): () => void {
  const { service, store } = input;

  return store.onReconcileSignal((signal) => {
    switch (signal.reason) {
      case "active-changed":
        service.setActiveContainer(signal.activeContainerId);
        break;
      case "hydrated":
        if (signal.activeContainerId) {
          service.enqueueContainer(signal.activeContainerId, "active");
        }
        break;
      case "prerequisites-regained":
        if (signal.activeContainerId) {
          service.enqueueContainer(signal.activeContainerId, "active");
        }
        service.enqueueIdleBackfill();
        break;
    }
  });
}

function readDocumentUpdateContainerIds(
  event: unknown,
): ReadonlyArray<string> | "all" | null {
  if (
    typeof event !== "object" ||
    event === null ||
    !("type" in event) ||
    event.type !== "document_update_created"
  ) {
    return null;
  }

  const containerIds = Reflect.get(event, "containerIds");
  if (containerIds === undefined) {
    // An update with no container scope could touch any container.
    return "all";
  }
  if (!Array.isArray(containerIds)) {
    return null;
  }
  return containerIds.filter(
    (containerId): containerId is string => typeof containerId === "string",
  );
}

/**
 * Translate a batch of server events into reconciler work. Containers named by
 * a `document_update_created` event are reconciled at active priority; an
 * unscoped update triggers an idle backfill across known containers.
 */
export function enqueueReconciliationForEvents(input: {
  events: ReadonlyArray<unknown>;
  knownContainerIds: ReadonlyArray<string>;
  service: ReconciliationService;
}): void {
  const { events, knownContainerIds, service } = input;
  let needsIdleBackfill = false;

  for (const event of events) {
    const containerIds = readDocumentUpdateContainerIds(event);
    if (containerIds === null) {
      continue;
    }
    if (containerIds === "all") {
      needsIdleBackfill = true;
      continue;
    }
    for (const containerId of containerIds) {
      if (knownContainerIds.includes(containerId)) {
        // Events signal fresh remote data, so force re-discovery even if this
        // container was already reconciled this session.
        service.enqueueContainer(containerId, "active", true);
      }
    }
  }

  if (needsIdleBackfill) {
    service.enqueueIdleBackfill();
  }
}
