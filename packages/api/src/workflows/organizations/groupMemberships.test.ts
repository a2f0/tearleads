import { expect, test } from "bun:test";
import { db } from "@symcrypt/api-shared/postgres";
import { groups } from "@symcrypt/api-shared/schema";
import { loadOrganizationGroupMembershipsInTransaction } from "./groupMemberships";

test("missing membership delta targets converge as deletions", async () => {
  const organizationId = crypto.randomUUID();
  const missingGroupId = crypto.randomUUID();
  const statelessGroupId = crypto.randomUUID();
  await db.insert(groups).values({
    id: statelessGroupId,
    name: "Stateless",
    organizationId,
  });

  const result = await loadOrganizationGroupMembershipsInTransaction({
    executor: db,
    groupIds: [missingGroupId, statelessGroupId],
    organizationId,
  });

  expect(result).toEqual({
    organizationId,
    deletedGroupIds: [missingGroupId, statelessGroupId].sort(),
    groups: [],
  });
});
