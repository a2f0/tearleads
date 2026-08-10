import {
  isDocumentMutationCreatedEvent,
  isDocumentUpdateCreatedEvent,
} from "../../data/documents/documentSync";
import type { DomainScope } from "../../data/domainScope";
import type { LocalProjectionStore } from "../../stores/local-projection";
import { consumeOriginatedDocument } from "./originatedDocuments";
import type { ReconciliationService } from "./serviceTypes";

function enqueueKnownEventContainers(input: {
  readonly containerIds: ReadonlyArray<string>;
  readonly knownContainerIds: ReadonlySet<string>;
  readonly service: ReconciliationService;
}): void {
  for (const containerId of input.containerIds) {
    if (input.knownContainerIds.has(containerId)) {
      input.service.enqueueContainer(containerId, "active", true);
    }
  }
}

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
      case "remote-containers-added":
        // A cold-cache tree crawl can finish after the auth-edge backfill was
        // queued. Pick up the newly materialized ids without resetting the
        // discovered suppression set for containers already reconciled.
        service.enqueueIdleBackfill();
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
 * document content or structural mutation events are reconciled at active
 * priority; an unscoped content update triggers an idle backfill across known
 * containers.
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
  const knownContainerIdSet = new Set(knownContainerIds);
  let needsIdleBackfill = false;

  for (const event of events) {
    if (isDocumentMutationCreatedEvent(event)) {
      // A link-set mutation changes membership even when the document is
      // already present locally. Never apply content-origination self-echo
      // suppression here: the server excludes only the exact authoring session,
      // while another session for the same identity must reconcile both sides.
      enqueueKnownEventContainers({
        containerIds: event.containerIds,
        knownContainerIds: knownContainerIdSet,
        service,
      });
      continue;
    }
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
    // Events signal fresh remote data, so force re-discovery even if this
    // container was already reconciled this session.
    enqueueKnownEventContainers({
      containerIds: event.containerIds,
      knownContainerIds: knownContainerIdSet,
      service,
    });
  }

  if (needsIdleBackfill) {
    service.enqueueIdleBackfill();
  }
}
