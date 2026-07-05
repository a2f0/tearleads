import type {
  ApiDatabase,
  DatabaseSession,
} from "@tearleads/api-shared/postgres";
import {
  groups as groupsTable,
  organizations,
} from "@tearleads/api-shared/schema";
import {
  isOrganizationContainerGrantSubjectType,
  type OrganizationContainerGrantResponse,
  type OrganizationContainerGrantsResponse,
} from "@tearleads/validators/response";
import { and, eq, inArray } from "drizzle-orm";
import { assertOrganizationCanSync } from "../billing/organizationBilling";
import { requireDirectOrganizationAccess } from "./access";
import {
  listOrganizationContainerGrantRows,
  type OrganizationContainerGrantRow,
  type OrganizationContainerGrantSubjectFilter,
  toOrganizationGroupContainerResponse,
} from "./containerGrants";
import { loadUsersById, type UserKeyRow } from "./users";

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
  if (!isOrganizationContainerGrantSubjectType(row.subjectType)) {
    throw new Error("Organization container grant subject type is invalid");
  }

  const user =
    row.subjectType === "user" ? input.usersById.get(row.subjectId) : null;

  return {
    ...toOrganizationGroupContainerResponse(row),
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
  await assertOrganizationCanSync(input.executor, input.organizationId);

  const grants = await listOrganizationContainerGrantResponsesInTransaction({
    executor: input.executor,
    organizationId: input.organizationId,
  });

  return {
    organizationId: input.organizationId,
    grants,
  };
}

export async function listOrganizationContainerGrantResponsesInTransaction(input: {
  executor: DatabaseSession;
  organizationId: string;
  subjectFilters?:
    | readonly OrganizationContainerGrantSubjectFilter[]
    | undefined;
}): Promise<OrganizationContainerGrantResponse[]> {
  const rows = await listOrganizationContainerGrantRows({
    executor: input.executor,
    organizationId: input.organizationId,
    subjectFilters: input.subjectFilters,
  });

  const groupNamesById = await loadGroupNamesById({
    executor: input.executor,
    groupIds: rows.flatMap((row) =>
      row.subjectType === "group" ? [row.subjectId] : [],
    ),
    organizationId: input.organizationId,
  });
  const userIds = uniqueSortedStrings(
    rows.flatMap((row) => (row.subjectType === "user" ? [row.subjectId] : [])),
  );
  const usersById =
    userIds.length > 0
      ? await loadUsersById(input.executor, userIds)
      : new Map<string, UserKeyRow>();
  const organizationNamesById = await loadOrganizationNamesById({
    executor: input.executor,
    organizationIds: rows.flatMap((row) =>
      row.subjectType === "organization" ? [row.subjectId] : [],
    ),
  });

  return rows.map((row) =>
    toOrganizationContainerGrantResponse({
      groupNamesById,
      organizationNamesById,
      row,
      usersById,
    }),
  );
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
