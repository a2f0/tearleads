import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import {
  accessManifestContainerGrantProjection,
  accessManifestHeads,
  accessManifests,
  containers,
  organizations,
} from "@tearleads/api-shared/schema";
import { deriveOrganizationMetadataContainerSystemSlot } from "@tearleads/validators/containerSystemSlot";
import {
  isOrganizationGroupContainerAccessLevel,
  type OrganizationGroupContainerResponse,
} from "@tearleads/validators/response";
import { and, asc, eq, or, sql } from "drizzle-orm";
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

/**
 * Lists the organization's current container grants. `isBuiltin` is derived
 * from the organization row: the Admins group on the root container, and the
 * Admins and Members groups on the derived metadata slot.
 */
export async function listOrganizationContainerGrantRows(input: {
  executor: DatabaseSession;
  organizationId: string;
}): Promise<OrganizationContainerGrantRow[]> {
  const metadataSlot = await deriveOrganizationMetadataContainerSystemSlot({
    organizationId: input.organizationId,
  });
  const subjectId = accessManifestContainerGrantProjection.subjectId;
  return input.executor
    .select({
      accessLevel: accessManifestContainerGrantProjection.accessLevel,
      containerId: containers.id,
      createdAt: containers.createdAt,
      depth: containers.depth,
      // Ordinary containers have a null slot, so the predicate can be null.
      isBuiltin: booleanExpression(
        sql`coalesce(${and(
          eq(accessManifestContainerGrantProjection.subjectType, "group"),
          or(
            and(
              eq(containers.id, organizations.rootContainerId),
              eq(subjectId, organizations.adminGroupId),
            ),
            and(
              eq(containers.systemSlot, metadataSlot),
              or(
                eq(subjectId, organizations.adminGroupId),
                eq(subjectId, organizations.memberGroupId),
              ),
            ),
          ),
        )}, false)`,
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
    .leftJoin(organizations, eq(organizations.id, containers.organizationId))
    .where(eq(containers.organizationId, input.organizationId))
    .orderBy(
      asc(accessManifestContainerGrantProjection.subjectType),
      asc(accessManifestContainerGrantProjection.subjectId),
      asc(containers.depth),
      asc(containers.id),
      asc(accessManifestContainerGrantProjection.accessLevel),
    );
}
