import type { DomainScope } from "../../data/domainScope";

/**
 * Per-scope set of remote document ids this client just originated (created or
 * uploaded). The server echoes a `document_update_created` for the client's own
 * writes; reconciling on that echo is pure waste because the client already has
 * the document locally. The local-projection link index cannot be relied on to
 * suppress it — that cache is refreshed by navigation/hydration/reconcile, not
 * by an upload completing, so a fast echo races ahead of it (see the residual
 * documented on `takePendingReconciliationEvents`). Recording the id at the
 * moment it is bound closes that race independently of cache timing.
 *
 * Entries are single-use: the first matching echo consumes them, so a genuine
 * later remote change to the same document still reconciles. The set is scoped
 * per `DomainScope` and cleared when the reconciler for that scope stops (scope
 * or identity teardown), so ids never leak across sessions.
 */
const originatedDocumentIdsByScope = new WeakMap<DomainScope, Set<string>>();

function getOrCreateOriginatedSet(scope: DomainScope): Set<string> {
  const existing = originatedDocumentIdsByScope.get(scope);
  if (existing) {
    return existing;
  }
  const created = new Set<string>();
  originatedDocumentIdsByScope.set(scope, created);
  return created;
}

/** Record remote document ids this client just created/uploaded in `scope`. */
export function markOriginatedDocuments(
  scope: DomainScope,
  documentIds: Iterable<string>,
): void {
  const set = getOrCreateOriginatedSet(scope);
  for (const documentId of documentIds) {
    if (documentId) {
      set.add(documentId);
    }
  }
}

/**
 * Consume an originated id: returns true (and removes it) when `documentId` was
 * an echo of this client's own write, false otherwise. Single-use so only the
 * first echo is suppressed.
 */
export function consumeOriginatedDocument(
  scope: DomainScope,
  documentId: string,
): boolean {
  return originatedDocumentIdsByScope.get(scope)?.delete(documentId) ?? false;
}

/** Drop all originated ids for a scope (reconciler stop / identity teardown). */
export function clearOriginatedDocuments(scope: DomainScope): void {
  originatedDocumentIdsByScope.get(scope)?.clear();
}
