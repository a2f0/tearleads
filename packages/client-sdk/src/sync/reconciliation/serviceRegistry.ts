import type { DomainScope } from "../../data/domainScope";
import type { ReconciliationService } from "./service";

const servicesByScope = new WeakMap<DomainScope, ReconciliationService>();

/** Track the scope's live reconciliation service (deviceFirst owns creation). */
export function registerReconciliationService(
  domainScope: DomainScope,
  service: ReconciliationService,
): void {
  servicesByScope.set(domainScope, service);
}

export function unregisterReconciliationService(
  domainScope: DomainScope,
  service: ReconciliationService,
): void {
  if (servicesByScope.get(domainScope) === service) {
    servicesByScope.delete(domainScope);
  }
}

/**
 * Force the scope's reconciler to re-discover the given containers, bypassing
 * its per-session discovered cache. Used after a synced document's local copy
 * is discarded: the reset SQLite watermark alone changes only what the next
 * discovery fetches, not *whether* one runs — without this nudge the server
 * copy re-materializes only on an explicit refresh or remote event. A no-op
 * when the scope has no live reconciler (e.g. headless workflows).
 */
export function requestForcedContainerReconciliation(
  domainScope: DomainScope,
  containerIds: ReadonlyArray<string>,
): void {
  const service = servicesByScope.get(domainScope);
  if (!service) {
    return;
  }
  for (const containerId of containerIds) {
    service.enqueueContainer(containerId, "active", true);
  }
}
