import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import { groups } from "@tearleads/api-shared/schema";
import type { PrincipalProjectionMemberRequest } from "@tearleads/validators/request";
import { and, eq, inArray } from "drizzle-orm";

export async function hasOnlySameOrganizationGroupMembers(input: {
  readonly executor: DatabaseSession;
  readonly organizationId: string;
  readonly projection: readonly PrincipalProjectionMemberRequest[];
}): Promise<boolean> {
  const nestedGroupIds = [
    ...new Set(
      input.projection
        .filter((member) => member.userId === "group")
        .map((member) => member.userId),
    ),
  ];
  if (nestedGroupIds.length === 0) {
    return true;
  }

  const localGroups = await input.executor
    .select({ groupId: groups.id })
    .from(groups)
    .where(
      and(
        eq(groups.organizationId, input.organizationId),
        inArray(groups.id, nestedGroupIds),
      ),
    );
  return localGroups.length === nestedGroupIds.length;
}
