import {
  type AccessManifestCheckpoint,
  KeyingVerificationError,
  type PrincipalPolicyCheckpoint,
  type VerifiedOrganizationReplacementAuthorization,
} from "@tearleads/crypto";
import type { ClientSQLiteTransactionScope } from "../../sqlite/sqlitePersistenceRuntime";
import { assertContainerNotRetired } from "../principalKeys/principalGrantRetirementPersistence";
import {
  loadStoredAccessManifestCheckpoint,
  loadStoredPrincipalPolicyCheckpoint,
  upsertAccessManifestCheckpointInTransaction,
  upsertPrincipalPolicyCheckpointInTransaction,
} from "./keyingCheckpointPersistence";
import { recordPrincipalPolicyOrganizationInTransaction } from "./principalPolicyOrganizationPersistence";

/**
 * A verified authorization from this identity also authenticates the winning
 * device's genesis. Seed first-sight pins before adopting its IDs; retain any
 * later observations rather than rolling them back to the provisioning epoch.
 */
export async function seedOrganizationReplacementCheckpointsInTransaction(
  tx: ClientSQLiteTransactionScope,
  authorization: VerifiedOrganizationReplacementAuthorization,
  updatedAt: string,
): Promise<void> {
  const organizationId = authorization.organizationId;
  const root: AccessManifestCheckpoint = {
    objectKind: "container",
    objectId: authorization.rootContainerId,
    organizationId,
    epoch: 1,
    manifestHash: authorization.rootManifestHash,
  };
  const principals: PrincipalPolicyCheckpoint[] = [
    {
      principalType: "organization",
      principalId: organizationId,
      version: 1,
      stateHash: authorization.organizationStateHash,
    },
    {
      principalType: "group",
      principalId: authorization.adminGroupId,
      version: 1,
      stateHash: authorization.adminGroupStateHash,
    },
    {
      principalType: "group",
      principalId: authorization.memberGroupId,
      version: 1,
      stateHash: authorization.memberGroupStateHash,
    },
  ];
  await assertContainerNotRetired(tx, root);
  const storedRoot = await loadStoredAccessManifestCheckpoint(tx, root);
  if (storedRoot?.epoch === 1 && storedRoot.manifestHash !== root.manifestHash)
    throw new KeyingVerificationError(
      "equivocation",
      "Replacement root conflicts with its local genesis checkpoint",
    );
  if (!storedRoot)
    await upsertAccessManifestCheckpointInTransaction(tx, root, updatedAt);
  for (const principal of principals) {
    await recordPrincipalPolicyOrganizationInTransaction(tx, {
      principalId: principal.principalId,
      principalType: principal.principalType,
      organizationId,
    });
    const stored = await loadStoredPrincipalPolicyCheckpoint(tx, principal);
    if (stored?.version === 1 && stored.stateHash !== principal.stateHash)
      throw new KeyingVerificationError(
        "equivocation",
        "Replacement policy conflicts with its local genesis checkpoint",
      );
    if (!stored)
      await upsertPrincipalPolicyCheckpointInTransaction(
        tx,
        principal,
        updatedAt,
        organizationId,
      );
  }
}
