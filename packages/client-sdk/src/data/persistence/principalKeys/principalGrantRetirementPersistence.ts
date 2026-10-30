import {
  type AccessManifestCheckpoint,
  KeyingVerificationError,
  type VerifiedPrincipalPolicy,
  type VerifiedPrincipalPolicyCurrent,
} from "@tearleads/crypto";
import { and, eq, inArray } from "drizzle-orm";
import { principalGrantRetirements } from "../../sqlite/schema/principalGrantRetirementSchema";
import { sqliteRowsPerStatement } from "../../sqlite/sqliteBindBudget";
import type { ClientSQLiteTransactionScope } from "../../sqlite/sqlitePersistenceRuntime";

export interface AcknowledgedPrincipalGrantRetirements {
  readonly containerIds: readonly string[];
  readonly organizationId: string;
  readonly policy: VerifiedPrincipalPolicy | VerifiedPrincipalPolicyCurrent;
}

export async function storePrincipalGrantRetirements(
  tx: ClientSQLiteTransactionScope,
  retirement: AcknowledgedPrincipalGrantRetirements,
  policies: readonly (
    | VerifiedPrincipalPolicy
    | VerifiedPrincipalPolicyCurrent
  )[],
  organizationId: string | undefined,
): Promise<void> {
  if (
    !policies.some(
      (policy) =>
        policy.principalId === retirement.policy.principalId &&
        policy.principalType === retirement.policy.principalType &&
        policy.stateHash === retirement.policy.stateHash,
    )
  ) {
    throw new KeyingVerificationError(
      "object_mismatch",
      "Retirement must accompany its acknowledged policy",
    );
  }
  const history =
    "retainedHistory" in retirement.policy
      ? retirement.policy.retainedHistory
      : retirement.policy.history;
  const previous = history?.find(
    (entry) => entry.state.stateHash === retirement.policy.state.prevStateHash,
  );
  const granted = new Set(
    [...retirement.policy.grants, ...(previous?.grants ?? [])].map(
      (grant) => grant.containerId,
    ),
  );
  if (
    retirement.organizationId !== organizationId ||
    retirement.containerIds.some((id) => !granted.has(id))
  ) {
    throw new KeyingVerificationError(
      "object_mismatch",
      "Retirement must match the acknowledged organization and signed grants",
    );
  }
  for (const containerId of new Set(retirement.containerIds)) {
    await tx
      .insert(principalGrantRetirements)
      .values({
        organizationId: retirement.organizationId,
        containerId,
        principalId: retirement.policy.principalId,
        policyStateHash: retirement.policy.stateHash,
      })
      .onConflictDoNothing()
      .run();
  }
}

export async function assertContainerNotRetired(
  tx: ClientSQLiteTransactionScope,
  checkpoint: AccessManifestCheckpoint,
): Promise<void> {
  if (checkpoint.objectKind !== "container") return;
  const [retired] = await tx
    .select({ containerId: principalGrantRetirements.containerId })
    .from(principalGrantRetirements)
    .where(
      and(
        eq(principalGrantRetirements.organizationId, checkpoint.organizationId),
        eq(principalGrantRetirements.containerId, checkpoint.objectId),
      ),
    )
    .limit(1);
  if (retired)
    throw new KeyingVerificationError(
      "equivocation",
      `Container ${checkpoint.objectId} was retired during principal rotation`,
    );
}

// A lookup binds its organization once.
const RETIREMENT_LOOKUP_BATCH_SIZE = sqliteRowsPerStatement(1, 1);

function retiredContainerKey(organizationId: string, containerId: string) {
  return JSON.stringify([organizationId, containerId]);
}

/**
 * The set form of `assertContainerNotRetired` for a batch of checkpoints: one
 * read per organization. The returned check throws the same error for each
 * checkpoint, so a caller replaying its batch in order fails at the same one.
 */
export async function loadContainerRetirementCheck(
  tx: ClientSQLiteTransactionScope,
  checkpoints: readonly AccessManifestCheckpoint[],
): Promise<(checkpoint: AccessManifestCheckpoint) => void> {
  const idsByOrganization = new Map<string, Set<string>>();
  for (const checkpoint of checkpoints)
    if (checkpoint.objectKind === "container")
      idsByOrganization.set(
        checkpoint.organizationId,
        (idsByOrganization.get(checkpoint.organizationId) ?? new Set()).add(
          checkpoint.objectId,
        ),
      );
  const retired = new Set<string>();
  for (const [organizationId, ids] of idsByOrganization) {
    const all = [...ids];
    for (
      let index = 0;
      index < all.length;
      index += RETIREMENT_LOOKUP_BATCH_SIZE
    ) {
      const rows = await tx
        .select({ containerId: principalGrantRetirements.containerId })
        .from(principalGrantRetirements)
        .where(
          and(
            eq(principalGrantRetirements.organizationId, organizationId),
            inArray(
              principalGrantRetirements.containerId,
              all.slice(index, index + RETIREMENT_LOOKUP_BATCH_SIZE),
            ),
          ),
        );
      for (const row of rows)
        retired.add(retiredContainerKey(organizationId, row.containerId));
    }
  }
  return (checkpoint) => {
    if (
      checkpoint.objectKind === "container" &&
      retired.has(
        retiredContainerKey(checkpoint.organizationId, checkpoint.objectId),
      )
    )
      throw new KeyingVerificationError(
        "equivocation",
        `Container ${checkpoint.objectId} was retired during principal rotation`,
      );
  };
}
