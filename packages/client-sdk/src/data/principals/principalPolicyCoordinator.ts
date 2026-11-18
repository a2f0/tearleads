import { createKeyedQueue } from "../shared/keyedQueue";
import { sqlConnectionIdentity } from "../sqlite/sqlExec";
import { type ExecSql, resolveCanonicalExecSql } from "../sqlite/sqlSchema";
import {
  type PrincipalMutationJournalScope,
  principalMutationJournalScopeId,
} from "./principalMutationJournal";

/**
 * Recovery hints belong to one scoped executor and its nested transactions.
 * Journal dispatch and recovery share the physical database's mutation lock
 * across sign-ins.
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

function createPrincipalPolicyCoordinator(
  journalScopes: ReturnType<typeof createKeyedQueue>,
): PrincipalPolicyCoordinator {
  const recoveries = createKeyedQueue();
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

const journals = new WeakMap<object, ReturnType<typeof createKeyedQueue>>();
const coordinators = new WeakMap<ExecSql, PrincipalPolicyCoordinator>();

export function getOrCreatePrincipalPolicyCoordinator(
  execSql: ExecSql,
): PrincipalPolicyCoordinator {
  const database = resolveCanonicalExecSql(execSql);
  let coordinator = coordinators.get(database);
  if (!coordinator) {
    const connection = sqlConnectionIdentity(execSql);
    const journal = journals.get(connection) ?? createKeyedQueue();
    journals.set(connection, journal);
    coordinator = createPrincipalPolicyCoordinator(journal);
    coordinators.set(database, coordinator);
  }
  return coordinator;
}
