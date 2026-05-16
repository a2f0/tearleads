import {
  isOrganizationContainerGrantSubjectType,
  isOrganizationGroupContainerAccessLevel,
  type OrganizationContainerGrantResponse,
  type OrganizationContainerGrantsResponse,
} from "@tearleads/validators/response";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { ApiDatabase, DatabaseSession } from "../../adapters/postgres";
import {
  accessManifestContainerGrantProjection,
  accessManifestHeads,
  accessManifests,
  containers,
  groups as groupsTable,
  organizations,
} from "../../schema";
import { requireDirectOrganizationAccess } from "./access";
import { loadUsersById, type UserKeyRow } from "./users";

interface OrganizationContainerGrantRow {
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

function uniqueSortedStrings(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

async function loadGroupNamesById(input: {
  executor: DatabaseSession;
  groupIds: readonly string[];
  organizationId: string;
}): Promise<Map<string, string>> {
  const groupIds = uniqueSortedStrings(input.groupIds);
  if (groupIds.length === 0) {
    return new Map();
  }

  const rows = await input.executor
    .select({
      groupId: groupsTable.id,
      groupName: groupsTable.name,
    })
    .from(groupsTable)
    .where(
      and(
        eq(groupsTable.organizationId, input.organizationId),
        inArray(groupsTable.id, groupIds),
      ),
    );

  return new Map(rows.map((row) => [row.groupId, row.groupName]));
}

async function loadOrganizationNamesById(input: {
  executor: DatabaseSession;
  organizationIds: readonly string[];
}): Promise<Map<string, string>> {
  const organizationIds = uniqueSortedStrings(input.organizationIds);
  if (organizationIds.length === 0) {
    return new Map();
  }

  const rows = await input.executor
    .select({
      organizationId: organizations.id,
      organizationName: organizations.name,
    })
    .from(organizations)
    .where(inArray(organizations.id, organizationIds));

  return new Map(rows.map((row) => [row.organizationId, row.organizationName]));
}

function toOrganizationContainerGrantResponse(input: {
  groupNamesById: ReadonlyMap<string, string>;
  organizationNamesById: ReadonlyMap<string, string>;
  row: OrganizationContainerGrantRow;
  usersById: ReadonlyMap<string, UserKeyRow>;
}): OrganizationContainerGrantResponse {
  const { row } = input;
  if (!isOrganizationGroupContainerAccessLevel(row.accessLevel)) {
    throw new Error("Organization container grant access level is invalid");
  }
  if (!isOrganizationContainerGrantSubjectType(row.subjectType)) {
    throw new Error("Organization container grant subject type is invalid");
  }

  const user =
    row.subjectType === "user" ? input.usersById.get(row.subjectId) : null;

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
    subjectType: row.subjectType,
    subjectId: row.subjectId,
    userId: row.subjectType === "user" ? (user?.userId ?? row.subjectId) : null,
    signingKeyFingerprint:
      row.subjectType === "user" ? (user?.signingKeyFingerprint ?? null) : null,
    groupId: row.subjectType === "group" ? row.subjectId : null,
    groupName:
      row.subjectType === "group"
        ? (input.groupNamesById.get(row.subjectId) ?? null)
        : null,
    organizationName:
      row.subjectType === "organization"
        ? (input.organizationNamesById.get(row.subjectId) ?? null)
        : null,
  };
}

async function listOrganizationContainerGrantsInTransaction(input: {
  executor: DatabaseSession;
  organizationId: string;
  sessionUserId: string;
}): Promise<OrganizationContainerGrantsResponse> {
  await requireDirectOrganizationAccess({
    executor: input.executor,
    organizationId: input.organizationId,
    userId: input.sessionUserId,
  });

  const rows = await input.executor
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
    .where(eq(containers.organizationId, input.organizationId))
    .orderBy(
      asc(accessManifestContainerGrantProjection.subjectType),
      asc(accessManifestContainerGrantProjection.subjectId),
      asc(containers.depth),
      asc(containers.id),
    );

  const groupNamesById = await loadGroupNamesById({
    executor: input.executor,
    groupIds: rows.flatMap((row) =>
      row.subjectType === "group" ? [row.subjectId] : [],
    ),
    organizationId: input.organizationId,
  });
  const usersById = await loadUsersById(
    input.executor,
    rows.flatMap((row) => (row.subjectType === "user" ? [row.subjectId] : [])),
  );
  const organizationNamesById = await loadOrganizationNamesById({
    executor: input.executor,
    organizationIds: rows.flatMap((row) =>
      row.subjectType === "organization" ? [row.subjectId] : [],
    ),
  });

  return {
    organizationId: input.organizationId,
    grants: rows.map((row) =>
      toOrganizationContainerGrantResponse({
        groupNamesById,
        organizationNamesById,
        row,
        usersById,
      }),
    ),
  };
}

export async function runListOrganizationContainerGrantsWorkflow(
  db: ApiDatabase,
  organizationId: string,
  sessionUserId: string,
): Promise<OrganizationContainerGrantsResponse> {
  return db.transaction((tx) =>
    listOrganizationContainerGrantsInTransaction({
      executor: tx,
      organizationId,
      sessionUserId,
    }),
  );
}
