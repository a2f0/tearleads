import type { DatabaseSession } from "@symcrypt/api-shared/postgres";
import {
  accessManifestContainerGrantProjection,
  accessManifestHeads,
  accessManifests,
  containerBuiltinGrants,
  containers,
} from "@symcrypt/api-shared/schema";
import {
  isOrganizationGroupContainerAccessLevel,
  type OrganizationGroupContainerResponse,
} from "@symcrypt/validators/response";
import { and, asc, eq, sql } from "drizzle-orm";
import { booleanExpression, jsonTextProperty } from "../../utils/sqlDialect";

export interface OrganizationContainerGrantRow {
  accessLevel: string;
  containerId: string;
  createdAt: Date;
  depth: number;
  isBuiltin: boolean;
  metadataAccessEpoch: number;
  metadataAccessStateHash: string;
  metadataDocumentId: string | null;
  parentId: string | null;
  subjectId: string;
  subjectType: string;
  updatedAt: Date;
}

export function toOrganizationGroupContainerResponse(
  row: OrganizationContainerGrantRow,
): OrganizationGroupContainerResponse {
  if (!isOrganizationGroupContainerAccessLevel(row.accessLevel)) {
    throw new Error("Organization container grant access level is invalid");
  }

  return {
    accessLevel: row.accessLevel,
    containerId: row.containerId,
    createdAt: row.createdAt.toISOString(),
    depth: row.depth,
    isBuiltin: row.isBuiltin,
    metadataAccessEpoch: row.metadataAccessEpoch,
    metadataAccessStateHash: row.metadataAccessStateHash,
    metadataDocumentId: row.metadataDocumentId,
    parentId: row.parentId,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function listOrganizationContainerGrantRows(input: {
  executor: DatabaseSession;
  organizationId: string;
}): Promise<OrganizationContainerGrantRow[]> {
  return input.executor
    .select({
      accessLevel: accessManifestContainerGrantProjection.accessLevel,
      containerId: containers.id,
      createdAt: containers.createdAt,
      depth: containers.depth,
      isBuiltin: booleanExpression(
        sql`${containerBuiltinGrants.id} is not null`,
      ),
      metadataAccessEpoch: accessManifestHeads.epoch,
      metadataAccessStateHash: accessManifestHeads.manifestHash,
      metadataDocumentId: sql<
        string | null
      >`${jsonTextProperty(sql`${accessManifests.state}`, "metadataDocumentId")}`,
      parentId: containers.parentId,
      subjectId: accessManifestContainerGrantProjection.subjectId,
      subjectType: accessManifestContainerGrantProjection.subjectType,
      updatedAt: accessManifestHeads.updatedAt,
    })
    .from(accessManifestContainerGrantProjection)
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
    .innerJoin(
      accessManifests,
      eq(accessManifests.manifestHash, accessManifestHeads.manifestHash),
    )
    .innerJoin(
      containers,
      eq(containers.id, accessManifestContainerGrantProjection.containerId),
    )
    .leftJoin(
      containerBuiltinGrants,
      and(
        eq(
          containerBuiltinGrants.containerId,
          accessManifestContainerGrantProjection.containerId,
        ),
        eq(
          containerBuiltinGrants.subjectType,
          accessManifestContainerGrantProjection.subjectType,
        ),
        eq(
          containerBuiltinGrants.subjectId,
          accessManifestContainerGrantProjection.subjectId,
        ),
      ),
    )
    .where(eq(containers.organizationId, input.organizationId))
    .orderBy(
      asc(accessManifestContainerGrantProjection.subjectType),
      asc(accessManifestContainerGrantProjection.subjectId),
      asc(containers.depth),
      asc(containers.id),
      asc(accessManifestContainerGrantProjection.accessLevel),
    );
}
