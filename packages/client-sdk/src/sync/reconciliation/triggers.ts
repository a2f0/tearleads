import { isDocumentUpdateCreatedEvent } from "../../data/documentSync";
import type { DomainScope } from "../../data/domainScope";
import type { LocalProjectionStore } from "../../stores/local-projection";
import { consumeOriginatedDocument } from "./originatedDocuments";
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
        // Auth/connectivity was just regained (relogin or reconnect). Forget the
        // per-session discovered set first: containers visited before the gap
        // may have changed remotely while this client was offline, and the
        // enqueue calls below are otherwise suppressed for already-discovered
        // containers. Resetting makes the active container and every backfill
        // target re-validate against the server exactly once.
        service.resetDiscovered();
        if (signal.activeContainerId) {
          service.enqueueContainer(signal.activeContainerId, "active");
        }
        service.enqueueIdleBackfill();
        break;
    }
  });
}

/**
 * Translate a batch of server events into reconciler work. Containers named by
 * a `document_update_created` event are reconciled at active priority; an
 * unscoped update triggers an idle backfill across known containers.
 *
 * `domainScope`, when provided, suppresses self-echoes: a `document_update_created`
 * whose documentId this client just originated (created/uploaded) is dropped
 * once, since reconciling it would only re-fetch a delta the client already has.
 * See {@link consumeOriginatedDocument}.
 */
export function enqueueReconciliationForEvents(input: {
  domainScope?: DomainScope;
  events: ReadonlyArray<unknown>;
  knownContainerIds: ReadonlyArray<string>;
  service: ReconciliationService;
}): void {
  const { domainScope, events, knownContainerIds, service } = input;
  let needsIdleBackfill = false;

  for (const event of events) {
    if (!isDocumentUpdateCreatedEvent(event)) {
      continue;
    }
    // Self-echo of this client's own create/upload: consume the origination and
    // skip. Single-use, so a genuine later remote change still reconciles.
    if (
      domainScope !== undefined &&
      consumeOriginatedDocument(domainScope, event.documentId)
    ) {
      continue;
    }
    if (event.containerIds === undefined) {
      // An update with no container scope could touch any container.
      needsIdleBackfill = true;
      continue;
    }
    for (const containerId of event.containerIds) {
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
