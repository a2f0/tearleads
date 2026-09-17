import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import {
  isOrganizationContainerGrantSubjectType,
  type OrganizationContainerGrantResponse,
} from "@tearleads/validators/response";
import { uniqueSortedStrings } from "../../utils/array";
import {
  listOrganizationContainerGrantRows,
  type OrganizationContainerGrantRow,
  toOrganizationGroupContainerResponse,
} from "./containerGrants";
import { loadUsersById, type UserKeyRow } from "./users";

function toOrganizationContainerGrantResponse(input: {
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

  const userIds = uniqueSortedStrings(
    rows.flatMap((row) => (row.subjectType === "user" ? [row.subjectId] : [])),
  );
  const usersById =
    userIds.length > 0
      ? await loadUsersById(input.executor, userIds)
      : new Map<string, UserKeyRow>();
  return rows.map((row) =>
    toOrganizationContainerGrantResponse({
      row,
      usersById,
    }),
  );
}
