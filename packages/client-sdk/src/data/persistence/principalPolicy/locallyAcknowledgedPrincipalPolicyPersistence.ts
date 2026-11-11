import {
  KeyingVerificationError,
  type PrincipalPolicyCheckpoint,
  type VerifiedPrincipalPolicy,
  verifyPrincipalPolicyCheckpoint,
} from "@tearleads/crypto";
import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import { keyingCheckpointTables } from "../../sqlite/schema/keyingCheckpointSchema";
import { principalPolicyTables } from "../../sqlite/schema/principalPolicySchema";
import {
  type ClientSQLiteTransactionScope,
  getClientSQLitePersistenceRuntime,
} from "../../sqlite/sqlitePersistenceRuntime";
import { type ExecSql, ensureSqlTables } from "../../sqlite/sqlSchema";
import {
  assertPrincipalPolicyCheckpointShape,
  loadStoredPrincipalPolicyCheckpoint,
  principalPolicyKey,
  upsertPrincipalPolicyCheckpointInTransaction,
} from "../keyingCheckpoints/keyingCheckpointPersistence";
import {
  type AcknowledgedPrincipalGrantRetirements,
  storePrincipalGrantRetirements,
} from "../principalKeys/principalGrantRetirementPersistence";
import {
  retainPrincipalPolicyBundleInTransaction,
  writePrincipalPolicyBundleInTransaction,
} from "./principalPolicyPersistence";
import { assertBundleMatchesVerifiedPolicy } from "./verifiedPrincipalPolicyBundle";

function validateAcknowledgedPolicy(
  policy: VerifiedPrincipalPolicy,
  checkpoint: PrincipalPolicyCheckpoint | null,
  genesis: boolean,
): boolean {
  if (genesis) {
    if (policy.version !== 1 || policy.state.prevStateHash !== null) {
      throw new KeyingVerificationError(
        "invalid_shape",
        "registration policy must begin at version 1",
      );
    }
    if (checkpoint) assertPrincipalPolicyCheckpointShape(checkpoint, policy);
    // Adoption never advances a newer pin back to genesis. Equal versions
    // still pass through the normal fork check below.
    if (checkpoint && checkpoint.version > policy.version) return false;
  }
  verifyPrincipalPolicyCheckpoint({
    chain: policy.history ?? [],
    currentState: policy.state,
    localCheckpoint: checkpoint,
  });
  if (!checkpoint && policy.version !== 1) {
    throw new KeyingVerificationError(
      "stale_predecessor",
      "locally acknowledged principal policy does not begin at version 1",
    );
  }
  if (checkpoint && policy.version > checkpoint.version + 1) {
    throw new KeyingVerificationError(
      "stale_predecessor",
      "locally acknowledged principal policy does not directly extend the durable checkpoint",
    );
  }
  return true;
}

interface LocallyAcknowledgedPrincipalPolicyBundle {
  readonly bundle: PrincipalPolicyBundleResponse;
  readonly policy: VerifiedPrincipalPolicy;
}

function assertUniqueAcknowledgedPolicies(
  entries: readonly LocallyAcknowledgedPrincipalPolicyBundle[],
): void {
  const seen = new Set<string>();
  for (const { policy } of entries) {
    const key = principalPolicyKey(policy);
    if (seen.has(key)) {
      throw new KeyingVerificationError(
        "duplicate_entry",
        `locally acknowledged policy batch repeats ${key}`,
      );
    }
    seen.add(key);
  }
}

async function storeAcknowledgedPrincipalPolicyBundles(input: {
  readonly retiredContainers?:
    | AcknowledgedPrincipalGrantRetirements
    | undefined;
  readonly entries: readonly LocallyAcknowledgedPrincipalPolicyBundle[];
  readonly execSql: ExecSql;
  readonly organizationId?: string | undefined;
  readonly placement: "current" | "history" | "genesis";
  readonly stillCurrent?: (() => boolean) | undefined;
  readonly updatedAt: string;
}): Promise<void> {
  assertUniqueAcknowledgedPolicies(input.entries);
  await Promise.all(
    input.entries.map((entry) => assertBundleMatchesVerifiedPolicy(entry)),
  );
  await ensureSqlTables(input.execSql, [
    ...principalPolicyTables,
    ...keyingCheckpointTables,
  ]);
  const runtime = getClientSQLitePersistenceRuntime(input.execSql);
  const store = async (tx: ClientSQLiteTransactionScope) => {
    const checkpoints: PrincipalPolicyCheckpoint[] = [];
    for (const { policy } of input.entries) {
      if (
        validateAcknowledgedPolicy(
          policy,
          await loadStoredPrincipalPolicyCheckpoint(tx, policy),
          input.placement === "genesis",
        )
      )
        checkpoints.push(policy.checkpoint);
    }
    if (input.retiredContainers)
      await storePrincipalGrantRetirements(
        tx,
        input.retiredContainers,
        input.entries.map(({ policy }) => policy),
        input.organizationId,
      );
    for (const entry of input.entries) {
      if (input.placement !== "history") {
        await writePrincipalPolicyBundleInTransaction(
          tx,
          entry.bundle,
          input.updatedAt,
          input.organizationId,
        );
      } else {
        await retainPrincipalPolicyBundleInTransaction(
          tx,
          entry.bundle,
          input.updatedAt,
          input.organizationId,
        );
      }
    }
    for (const checkpoint of checkpoints) {
      await upsertPrincipalPolicyCheckpointInTransaction(
        tx,
        checkpoint,
        input.updatedAt,
        input.organizationId,
      );
    }
  };
  if (input.stillCurrent) {
    await runtime.guardedTransaction(store, input.stillCurrent, {
      behavior: "immediate",
    });
    return;
  }
  await runtime.transaction(store, { behavior: "immediate" });
}

/** Atomically pins and caches exact full policy bundles acknowledged by the API. */
export function persistLocallyAcknowledgedPrincipalPolicyBundles(input: {
  readonly entries: readonly LocallyAcknowledgedPrincipalPolicyBundle[];
  readonly execSql: ExecSql;
  readonly organizationId?: string | undefined;
  readonly stillCurrent?: (() => boolean) | undefined;
  readonly updatedAt: string;
}): Promise<void> {
  return storeAcknowledgedPrincipalPolicyBundles({
    ...input,
    placement: "current",
  });
}

export function persistLocallyAcknowledgedPrincipalPolicyBundle(
  input: LocallyAcknowledgedPrincipalPolicyBundle & {
    readonly execSql: ExecSql;
    readonly organizationId?: string | undefined;
    readonly stillCurrent?: (() => boolean) | undefined;
    readonly updatedAt: string;
  },
): Promise<void> {
  return persistLocallyAcknowledgedPrincipalPolicyBundles({
    entries: [input],
    execSql: input.execSql,
    organizationId: input.organizationId,
    stillCurrent: input.stillCurrent,
    updatedAt: input.updatedAt,
  });
}

/**
 * Seed a provisioning acknowledgement without making genesis current again.
 * The cache writer still checks ownership, equal-version forks and retained
 * same-hash bundle integrity, and preserves any newer cached policy head.
 */
export function seedLocallyAcknowledgedPrincipalPolicyBundles(
  input: Parameters<typeof persistLocallyAcknowledgedPrincipalPolicyBundles>[0],
): Promise<void> {
  return storeAcknowledgedPrincipalPolicyBundles({
    ...input,
    placement: "genesis",
  });
}

export function retainLocallyAcknowledgedPrincipalPolicyBundles(input: {
  readonly retiredContainers?:
    | AcknowledgedPrincipalGrantRetirements
    | undefined;
  readonly entries: readonly LocallyAcknowledgedPrincipalPolicyBundle[];
  readonly execSql: ExecSql;
  readonly organizationId?: string | undefined;
  readonly stillCurrent?: (() => boolean) | undefined;
  readonly updatedAt: string;
}): Promise<void> {
  return storeAcknowledgedPrincipalPolicyBundles({
    ...input,
    placement: "history",
  });
}
