import type { ExecSql } from "../../data/sqlite/sqlSchema";

// Directory and Admins stages are shared by every reference in an organization.
// Coordinate runtime callers across warmer instances; different databases and
// organizations keep independent queues. Completed queues retain no work.
const queues = new WeakMap<ExecSql, Map<string, Promise<void>>>();

export function queuePrincipalRecovery<T>(
  execSql: ExecSql,
  organizationId: string,
  work: () => Promise<T>,
): Promise<T> {
  let scoped = queues.get(execSql);
  if (!scoped) {
    scoped = new Map();
    queues.set(execSql, scoped);
  }
  const operation = (scoped.get(organizationId) ?? Promise.resolve()).then(
    work,
  );
  const settled = operation.then(
    () => undefined,
    () => undefined,
  );
  scoped.set(organizationId, settled);
  const owned = scoped;
  void settled.then(() => {
    if (owned.get(organizationId) === settled) owned.delete(organizationId);
  });
  return operation;
}
