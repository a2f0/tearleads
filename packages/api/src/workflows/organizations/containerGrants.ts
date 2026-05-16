import {
  isOrganizationGroupContainerAccessLevel,
  type OrganizationGroupContainerResponse,
} from "@tearleads/validators/response";
import { and, asc, eq, sql } from "drizzle-orm";
import type { DatabaseSession } from "../../adapters/postgres";
import {
  accessManifestContainerGrantProjection,
  accessManifestHeads,
  accessManifests,
  containers,
} from "../../schema";

export interface OrganizationContainerGrantRow {
  accessLevel: string;
  containerId: string;
  createdAt: Date;
  depth: number;
  metadataAccessEpoch: number;
  metadataAccessStateHash: string;
  metadataDocumentId: string | null;
  parentId: string | null;
  subjectId: string;
  subjectType: string;
  updatedAt: Date;
}

interface OrganizationContainerGrantSubjectFilter {
  subjectId: string;
  subjectType: "group" | "organization" | "user";
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
  subjectFilter?: OrganizationContainerGrantSubjectFilter | undefined;
}): Promise<OrganizationContainerGrantRow[]> {
  return input.executor
    .select({
      accessLevel: accessManifestContainerGrantProjection.accessLevel,
      containerId: containers.id,
      createdAt: containers.createdAt,
      depth: containers.depth,
      metadataAccessEpoch: accessManifestHeads.epoch,
      metadataAccessStateHash: accessManifestHeads.manifestHash,
      metadataDocumentId: sql<
        string | null
      >`${accessManifests.state}->>'metadataDocumentId'`,
      parentId: containers.parentId,
      subjectId: accessManifestContainerGrantProjection.subjectId,
      subjectType: accessManifestContainerGrantProjection.subjectType,
      updatedAt: containers.updatedAt,
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
    .where(
      and(
        eq(containers.organizationId, input.organizationId),
        input.subjectFilter
          ? and(
              eq(
                accessManifestContainerGrantProjection.subjectType,
                input.subjectFilter.subjectType,
              ),
              eq(
                accessManifestContainerGrantProjection.subjectId,
                input.subjectFilter.subjectId,
              ),
            )
          : undefined,
      ),
    )
    .orderBy(
      asc(accessManifestContainerGrantProjection.subjectType),
      asc(accessManifestContainerGrantProjection.subjectId),
      asc(containers.depth),
      asc(containers.id),
      asc(accessManifestContainerGrantProjection.accessLevel),
    );
}
