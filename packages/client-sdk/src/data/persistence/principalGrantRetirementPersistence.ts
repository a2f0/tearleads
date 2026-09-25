import {
  type AccessManifestCheckpoint,
  KeyingVerificationError,
  type VerifiedPrincipalPolicy,
} from "@tearleads/crypto";
import { and, eq } from "drizzle-orm";
import { principalGrantRetirements } from "../sqlite/principalGrantRetirementSchema";
import type { ClientSQLiteTransactionScope } from "../sqlite/sqlitePersistenceRuntime";

export interface AcknowledgedPrincipalGrantRetirements {
  readonly containerIds: readonly string[];
  readonly organizationId: string;
  readonly policy: VerifiedPrincipalPolicy;
}

export async function storePrincipalGrantRetirements(
  tx: ClientSQLiteTransactionScope,
  retirement: AcknowledgedPrincipalGrantRetirements,
  policies: readonly VerifiedPrincipalPolicy[],
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
