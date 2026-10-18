import { type ExecSql, resolveCanonicalExecSql } from "../sqlite/sqlSchema";
import {
  type PrincipalMutationJournalScope,
  principalMutationJournalScopeId,
} from "./principalMutationJournal";

/**
 * The principal-policy work one database coordinates in this process. Every
 * executor for a connection, including a transaction's locked one, resolves to
 * the same coordinator; different databases never share one.
 */
export interface PrincipalPolicyCoordinator {
  /**
   * Runs recovery for an organization after the recovery already queued for
   * it. Directory and Admins stages are shared by every reference in an
   * organization, so warmers and registration take turns. Queued work must not
   * queue again for the same organization.
   */
  queueRecovery<T>(organizationId: string, work: () => Promise<T>): Promise<T>;
  /**
   * The organization hints applied in this process. Operation-scoped recovery
   * records it before producing a result and recovers again once it changes.
   * Hints are lossy, so this only shortens reuse; each operation still
   * discovers the current head.
   */
  recoveryEpoch(organizationId: string): number;
  /** Evicts recovered directory and Admins views for this organization. */
  invalidateRecovery(organizationId: string): void;
  /** An owned dispatch finishes before another caller can recover or abandon it. */
  runJournalOperation<T>(
    scope: PrincipalMutationJournalScope,
    run: () => Promise<T>,
  ): Promise<T>;
}

/** Runs work for a key after the work already queued for it; idle keys hold nothing. */
function createKeyedQueue() {
  const tails = new Map<string, Promise<void>>();
  return <T>(key: string, work: () => Promise<T>): Promise<T> => {
    const operation = (tails.get(key) ?? Promise.resolve()).then(work);
    const settled = operation.then(
      () => undefined,
      () => undefined,
    );
    tails.set(key, settled);
    void settled.then(() => {
      if (tails.get(key) === settled) tails.delete(key);
    });
    return operation;
  };
}

function createPrincipalPolicyCoordinator(): PrincipalPolicyCoordinator {
  const recoveries = createKeyedQueue();
  const journalScopes = createKeyedQueue();
  const epochs = new Map<string, number>();
  return {
    queueRecovery: recoveries,
    recoveryEpoch: (organizationId) => epochs.get(organizationId) ?? 0,
    invalidateRecovery: (organizationId) => {
      epochs.set(organizationId, (epochs.get(organizationId) ?? 0) + 1);
    },
    runJournalOperation: async (scope, run) =>
      journalScopes(await principalMutationJournalScopeId(scope), run),
  };
}

const coordinators = new WeakMap<ExecSql, PrincipalPolicyCoordinator>();

export function getOrCreatePrincipalPolicyCoordinator(
  execSql: ExecSql,
): PrincipalPolicyCoordinator {
  const database = resolveCanonicalExecSql(execSql);
  let coordinator = coordinators.get(database);
  if (!coordinator) {
    coordinator = createPrincipalPolicyCoordinator();
    coordinators.set(database, coordinator);
  }
  return coordinator;
}
