import type { ExecSql } from "../sqlite/sqlSchema";

// Per database and organization, the number of applied organization hints in
// this process. Operation-scoped principal recovery records the value before
// producing a result and recovers again once it changes. Hints are lossy, so
// this only shortens reuse; each operation still discovers the current head.
const epochs = new WeakMap<ExecSql, Map<string, number>>();

export function principalRecoveryEpoch(
  execSql: ExecSql,
  organizationId: string,
): number {
  return epochs.get(execSql)?.get(organizationId) ?? 0;
}

/** Evict recovered directory and Admins views for this organization. */
export function invalidatePrincipalRecovery(
  execSql: ExecSql,
  organizationId: string,
): void {
  let scoped = epochs.get(execSql);
  if (!scoped) {
    scoped = new Map();
    epochs.set(execSql, scoped);
  }
  scoped.set(organizationId, (scoped.get(organizationId) ?? 0) + 1);
}
