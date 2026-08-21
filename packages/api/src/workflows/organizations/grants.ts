import type { DatabaseSession } from "@symcrypt/api-shared/postgres";
import { groups as groupsTable } from "@symcrypt/api-shared/schema";
import {
  isOrganizationContainerGrantSubjectType,
  type OrganizationContainerGrantResponse,
} from "@symcrypt/validators/response";
import { and, eq, inArray } from "drizzle-orm";
import { uniqueSortedStrings } from "../../utils/array";
import {
  listOrganizationContainerGrantRows,
  type OrganizationContainerGrantRow,
  toOrganizationGroupContainerResponse,
} from "./containerGrants";
import { loadUsersById, type UserKeyRow } from "./users";

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

function toOrganizationContainerGrantResponse(input: {
  groupNamesById: ReadonlyMap<string, string>;
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
  };
}

export async function listOrganizationContainerGrantResponsesInTransaction(input: {
  executor: DatabaseSession;
  organizationId: string;
}): Promise<OrganizationContainerGrantResponse[]> {
  const rows = await listOrganizationContainerGrantRows({
    executor: input.executor,
    organizationId: input.organizationId,
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
  return rows.map((row) =>
    toOrganizationContainerGrantResponse({
      groupNamesById,
      row,
      usersById,
    }),
  );
}
