import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  groups,
  organizationGroupTombstones,
} from "@tearleads/api-shared/schema";
import { loadOrganizationGroupMembershipsInTransaction } from "./groupMemberships";

test("membership deltas report stamped tombstones and stateless rows as deletions", async () => {
  const organizationId = crypto.randomUUID();
  const deletedGroupId = crypto.randomUUID();
  const statelessGroupId = crypto.randomUUID();
  const unchangedGroupId = crypto.randomUUID();
  const earlierDeletedGroupId = crypto.randomUUID();
  await db.insert(groups).values([
    { id: statelessGroupId, membershipCursor: 5n, organizationId },
    { id: unchangedGroupId, membershipCursor: 3n, organizationId },
  ]);
  await db.insert(organizationGroupTombstones).values([
    { deletedCursor: 6n, groupId: deletedGroupId, organizationId },
    { deletedCursor: 2n, groupId: earlierDeletedGroupId, organizationId },
  ]);

  const delta = await loadOrganizationGroupMembershipsInTransaction({
    changedAfterCursor: 4n,
    executor: db,
    organizationId,
  });
  expect(delta).toEqual({
    organizationId,
    deletedGroupIds: [deletedGroupId, statelessGroupId].sort(),
    groups: [],
  });

  const snapshot = await loadOrganizationGroupMembershipsInTransaction({
    executor: db,
    organizationId,
  });
  expect(snapshot).toEqual({ organizationId, deletedGroupIds: [], groups: [] });
});
