import {
  isOrganizationGroupContainerAccessLevel,
  type OrganizationGroupContainerResponse,
} from "@tearleads/validators/response";
import { and, asc, eq, inArray, or, sql } from "drizzle-orm";
import type { DatabaseSession } from "../../adapters/postgres";
import {
  accessManifestContainerGrantProjection,
  accessManifestHeads,
  accessManifests,
  containerBuiltinGrants,
  containers,
} from "../../schema";

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

export interface OrganizationContainerGrantSubjectFilter {
  subjectId: string;
  subjectType: "group" | "organization" | "user";
}

function uniqueSortedStrings(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function buildSubjectFilterCondition(
  filters: readonly OrganizationContainerGrantSubjectFilter[],
) {
  if (filters.length === 0) {
    return undefined;
  }

  const groupIds = uniqueSortedStrings(
    filters.flatMap((filter) =>
      filter.subjectType === "group" ? [filter.subjectId] : [],
    ),
  );
  const organizationIds = uniqueSortedStrings(
    filters.flatMap((filter) =>
      filter.subjectType === "organization" ? [filter.subjectId] : [],
    ),
  );
  const userIds = uniqueSortedStrings(
    filters.flatMap((filter) =>
      filter.subjectType === "user" ? [filter.subjectId] : [],
    ),
  );

  return or(
    groupIds.length > 0
      ? and(
          eq(accessManifestContainerGrantProjection.subjectType, "group"),
          inArray(accessManifestContainerGrantProjection.subjectId, groupIds),
        )
      : undefined,
    organizationIds.length > 0
      ? and(
          eq(
            accessManifestContainerGrantProjection.subjectType,
            "organization",
          ),
          inArray(
            accessManifestContainerGrantProjection.subjectId,
            organizationIds,
          ),
        )
      : undefined,
    userIds.length > 0
      ? and(
          eq(accessManifestContainerGrantProjection.subjectType, "user"),
          inArray(accessManifestContainerGrantProjection.subjectId, userIds),
        )
      : undefined,
  );
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
  subjectFilter?: OrganizationContainerGrantSubjectFilter | undefined;
  subjectFilters?:
    | readonly OrganizationContainerGrantSubjectFilter[]
    | undefined;
}): Promise<OrganizationContainerGrantRow[]> {
  const subjectFilters = [
    ...(input.subjectFilter ? [input.subjectFilter] : []),
    ...(input.subjectFilters ?? []),
  ];

  return input.executor
    .select({
      accessLevel: accessManifestContainerGrantProjection.accessLevel,
      containerId: containers.id,
      createdAt: containers.createdAt,
      depth: containers.depth,
      isBuiltin: sql<boolean>`${containerBuiltinGrants.id} is not null`,
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
    .leftJoin(
      containerBuiltinGrants,
      and(
        eq(containerBuiltinGrants.organizationId, containers.organizationId),
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
    .where(
      and(
        eq(containers.organizationId, input.organizationId),
        buildSubjectFilterCondition(subjectFilters),
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
