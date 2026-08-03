import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { groups } from "@tearleads/api-shared/schema";
import { hasOnlySameOrganizationGroupMembers } from "./groupPolicyScope";

function groupMember(groupId: string) {
  return {
    userId: groupId,
    role: "member" as const,
  };
}

test("organization policies accept only groups from the same organization", async () => {
  const organizationId = crypto.randomUUID();
  const localGroupId = crypto.randomUUID();
  const foreignGroupId = crypto.randomUUID();
  const standaloneGroupId = crypto.randomUUID();
  await db.insert(groups).values([
    { id: localGroupId, organizationId, name: "Local" },
    {
      id: foreignGroupId,
      organizationId: crypto.randomUUID(),
      name: "Foreign",
    },
    { id: standaloneGroupId, organizationId: null, name: "Standalone" },
  ]);

  expect(
    await hasOnlySameOrganizationGroupMembers({
      executor: db,
      organizationId,
      projection: [groupMember(localGroupId)],
    }),
  ).toBe(true);
  for (const groupId of [
    foreignGroupId,
    standaloneGroupId,
    crypto.randomUUID(),
  ]) {
    expect(
      await hasOnlySameOrganizationGroupMembers({
        executor: db,
        organizationId,
        projection: [groupMember(groupId)],
      }),
    ).toBe(false);
  }
});
