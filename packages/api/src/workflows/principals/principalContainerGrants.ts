import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import {
  accessManifestContainerGrantProjection,
  accessManifestHeads,
  accessManifestPrincipalHeadProjection,
  containers,
} from "@tearleads/api-shared/schema";
import type { PrincipalContainerGrant } from "@tearleads/crypto";
import { and, eq, inArray } from "drizzle-orm";
import { PrincipalPolicyError } from "./shared";

function requirePrincipalGrantAccessLevel(
  value: string,
): PrincipalContainerGrant["accessLevel"] {
  if (value !== "admin" && value !== "read" && value !== "write") {
    throw new Error(
      "Stored principal container grant has an invalid access level",
    );
  }
  return value;
}

interface CurrentPrincipalContainerGrant extends PrincipalContainerGrant {
  readonly keyEpoch: number | null;
  readonly keyFingerprint: string | null;
  readonly stateHash: string | null;
  readonly version: number | null;
}

export async function listCurrentPrincipalContainerGrants(input: {
  readonly executor: DatabaseTransaction;
  readonly principalId: string;
}): Promise<CurrentPrincipalContainerGrant[]> {
  const rows = await input.executor
    .select({
      accessLevel: accessManifestContainerGrantProjection.accessLevel,
      containerId: accessManifestContainerGrantProjection.containerId,
      keyEpoch: accessManifestPrincipalHeadProjection.keyEpoch,
      keyFingerprint: accessManifestPrincipalHeadProjection.keyFingerprint,
      stateHash: accessManifestPrincipalHeadProjection.stateHash,
      version: accessManifestPrincipalHeadProjection.version,
    })
    .from(accessManifestContainerGrantProjection)
    .innerJoin(
      containers,
      eq(containers.id, accessManifestContainerGrantProjection.containerId),
    )
    .innerJoin(
      accessManifestHeads,
      and(
        eq(accessManifestHeads.objectKind, "container"),
        eq(
          accessManifestHeads.objectId,
          accessManifestContainerGrantProjection.containerId,
        ),
        eq(
          accessManifestHeads.manifestHash,
          accessManifestContainerGrantProjection.manifestHash,
        ),
      ),
    )
    .leftJoin(
      accessManifestPrincipalHeadProjection,
      and(
        eq(
          accessManifestPrincipalHeadProjection.manifestHash,
          accessManifestContainerGrantProjection.manifestHash,
        ),
        eq(accessManifestPrincipalHeadProjection.principalType, "group"),
        eq(
          accessManifestPrincipalHeadProjection.principalId,
          input.principalId,
        ),
      ),
    )
    .where(
      and(
        eq(accessManifestContainerGrantProjection.subjectType, "group"),
        eq(accessManifestContainerGrantProjection.subjectId, input.principalId),
      ),
    );

  return rows
    .map((row) => ({
      ...row,
      accessLevel: requirePrincipalGrantAccessLevel(row.accessLevel),
    }))
    .sort((left, right) => left.containerId.localeCompare(right.containerId));
}

/** Retained heads reserve deleted identities; they no longer carry live grants. */
export async function livePrincipalContainerGrants(
  executor: DatabaseTransaction,
  grants: readonly PrincipalContainerGrant[],
): Promise<PrincipalContainerGrant[]> {
  if (grants.length === 0) return [];
  const rows = await executor
    .select({
      containerId: accessManifestHeads.objectId,
      liveId: containers.id,
    })
    .from(accessManifestHeads)
    .leftJoin(containers, eq(containers.id, accessManifestHeads.objectId))
    .where(
      and(
        eq(accessManifestHeads.objectKind, "container"),
        inArray(
          accessManifestHeads.objectId,
          grants.map((grant) => grant.containerId),
        ),
      ),
    );
  const byId = new Map(rows.map((row) => [row.containerId, row]));
  return grants.filter((grant) => {
    const row = byId.get(grant.containerId);
    if (!row)
      throw new PrincipalPolicyError(
        "Principal grant container does not exist",
        409,
      );
    return row.liveId !== null;
  });
}
