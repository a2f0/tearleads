import type { ExecSql } from "../../sqlite/sqlSchema";

export type OrganizationReadModelInvalidationListener = (
  organizationId: string,
) => void;

const listenersByExecutor = new WeakMap<
  ExecSql,
  Set<OrganizationReadModelInvalidationListener>
>();

/**
 * Observe load-path purges of the durable organization read-model projection
 * (protocol mismatch or stored-row integrity failure). A purge outside a
 * reconcile pass leaves realtime consumers believing they are caught up while
 * the rows they painted are gone; subscribers drop that state and schedule a
 * fresh authoritative catch-up.
 */
export function subscribeOrganizationReadModelInvalidation(
  execSql: ExecSql,
  listener: OrganizationReadModelInvalidationListener,
): () => void {
  let listeners = listenersByExecutor.get(execSql);
  if (!listeners) {
    listeners = new Set();
    listenersByExecutor.set(execSql, listeners);
  }
  listeners.add(listener);
  const registered = listeners;
  return () => {
    registered.delete(listener);
  };
}

export function notifyOrganizationReadModelInvalidated(
  execSql: ExecSql,
  organizationId: string,
): void {
  const listeners = listenersByExecutor.get(execSql);
  if (!listeners) {
    return;
  }
  for (const listener of [...listeners]) {
    try {
      listener(organizationId);
    } catch {
      // A listener failure must not fail the load that purged the rows.
    }
  }
}
