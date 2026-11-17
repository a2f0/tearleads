import {
  KeyingVerificationError,
  type VerifiedPrincipalPolicy,
} from "@tearleads/crypto";
import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import type { ClientSQLiteTransactionScope } from "../../sqlite/sqlitePersistenceRuntime";
import {
  validatePrincipalPolicyCheckpointAdvances,
  writePrincipalPolicyCheckpoints,
} from "../keyingCheckpoints/keyingCheckpointAdvancePersistence";
import {
  loadStoredPrincipalPolicyCheckpoints,
  principalPolicyKey,
} from "../keyingCheckpoints/keyingCheckpointPersistence";
import {
  assertPrincipalPolicyBundleStoredInTransaction,
  writePrincipalPolicyBundleInTransaction,
} from "./principalPolicyPersistence";
import { assertBundleMatchesVerifiedPolicy } from "./verifiedPrincipalPolicyBundle";

export interface VerifiedPrincipalPolicyBundleEntry {
  readonly bundle: PrincipalPolicyBundleResponse;
  readonly policy: VerifiedPrincipalPolicy;
}

/** Rejects a batch that repeats a principal or mismatches its verified policy. */
export async function assertVerifiedPrincipalPolicyBundles(
  entries: readonly VerifiedPrincipalPolicyBundleEntry[],
): Promise<void> {
  const seen = new Set<string>();
  for (const entry of entries) {
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
    entries.map((entry) => assertBundleMatchesVerifiedPolicy(entry)),
  );
}

/**
 * Writes each verified bundle with its durable head, then reads both back, so
 * a checkpoint never lands without its exact same-head bundle.
 */
export async function persistVerifiedPrincipalPolicyBundlesInTransaction(
  tx: ClientSQLiteTransactionScope,
  input: {
    readonly entries: readonly VerifiedPrincipalPolicyBundleEntry[];
    readonly organizationId?: string | undefined;
  },
  updatedAt: string,
): Promise<void> {
  const policies = await validatePrincipalPolicyCheckpointAdvances(
    tx,
    input.entries.map((entry) => entry.policy),
  );
  for (const entry of input.entries) {
    await writePrincipalPolicyBundleInTransaction(
      tx,
      entry.bundle,
      updatedAt,
      input.organizationId,
    );
    await assertPrincipalPolicyBundleStoredInTransaction(tx, entry.bundle);
  }
  await writePrincipalPolicyCheckpoints(
    tx,
    policies,
    updatedAt,
    input.organizationId,
  );
  const stored = await loadStoredPrincipalPolicyCheckpoints(tx, [
    ...policies.values(),
  ]);
  for (const policy of policies.values()) {
    const checkpoint = stored.get(principalPolicyKey(policy));
    if (
      !checkpoint ||
      checkpoint.version !== policy.version ||
      checkpoint.stateHash !== policy.stateHash
    ) {
      throw new Error("Verified principal policy checkpoint was not persisted");
    }
  }
}
