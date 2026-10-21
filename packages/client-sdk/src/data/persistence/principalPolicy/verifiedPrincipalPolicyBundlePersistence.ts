import {
  KeyingVerificationError,
  type VerifiedPrincipalPolicy,
} from "@tearleads/crypto";
import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import {
  keyingCheckpointTables,
  principalPolicyTables,
} from "../../sqlite/schema";
import {
  type ClientSQLiteTransactionScope,
  getClientSQLitePersistenceRuntime,
} from "../../sqlite/sqlitePersistenceRuntime";
import { type ExecSql, ensureSqlTables } from "../../sqlite/sqlSchema";
import {
  validatePrincipalPolicyCheckpointAdvances,
  writePrincipalPolicyCheckpoints,
} from "../keyingCheckpoints/keyingCheckpointAdvancePersistence";
import {
  loadStoredPrincipalPolicyCheckpoint,
  principalPolicyKey,
} from "../keyingCheckpoints/keyingCheckpointPersistence";
import {
  assertPrincipalPolicyBundleStoredInTransaction,
  writePrincipalPolicyBundleInTransaction,
} from "./principalPolicyPersistence";
import { assertBundleMatchesVerifiedPolicy } from "./verifiedPrincipalPolicyBundle";

interface VerifiedPrincipalPolicyBundleEntry {
  readonly bundle: PrincipalPolicyBundleResponse;
  readonly policy: VerifiedPrincipalPolicy;
}

/**
 * Persists each verified full policy bundle together with its durable head.
 * This prevents a crash or bundle-write failure from leaving a checkpoint
 * without the exact same-head payload and member-envelope evidence.
 */
export async function persistVerifiedPrincipalPolicyBundlesAtomically(input: {
  readonly entries: readonly VerifiedPrincipalPolicyBundleEntry[];
  readonly execSql: ExecSql;
  readonly organizationId?: string | undefined;
  readonly stillCurrent?: (() => boolean) | undefined;
  readonly updatedAt: string;
}): Promise<void> {
  const seen = new Set<string>();
  for (const entry of input.entries) {
    const key = principalPolicyKey(entry.policy);
    if (seen.has(key)) {
      throw new KeyingVerificationError(
        "duplicate_entry",
        `verified policy bundle batch repeats ${key}`,
      );
    }
    seen.add(key);
  }
  await Promise.all(
    input.entries.map((entry) => assertBundleMatchesVerifiedPolicy(entry)),
  );
  await ensureSqlTables(input.execSql, [
    ...principalPolicyTables,
    ...keyingCheckpointTables,
  ]);

  const runtime = getClientSQLitePersistenceRuntime(input.execSql);
  const persist = async (tx: ClientSQLiteTransactionScope) => {
    const policies = await validatePrincipalPolicyCheckpointAdvances(
      tx,
      input.entries.map((entry) => entry.policy),
    );
    for (const entry of input.entries) {
      await writePrincipalPolicyBundleInTransaction(
        tx,
        entry.bundle,
        input.updatedAt,
        input.organizationId,
      );
      await assertPrincipalPolicyBundleStoredInTransaction(tx, entry.bundle);
    }
    await writePrincipalPolicyCheckpoints(
      tx,
      policies,
      input.updatedAt,
      input.organizationId,
    );
    for (const policy of policies.values()) {
      const checkpoint = await loadStoredPrincipalPolicyCheckpoint(tx, policy);
      if (
        !checkpoint ||
        checkpoint.version !== policy.version ||
        checkpoint.stateHash !== policy.stateHash
      ) {
        throw new Error(
          "Verified principal policy checkpoint was not persisted",
        );
      }
    }
  };
  if (input.stillCurrent) {
    await runtime.guardedTransaction(persist, input.stillCurrent, {
      behavior: "immediate",
    });
    return;
  }
  await runtime.transaction(persist, { behavior: "immediate" });
}
