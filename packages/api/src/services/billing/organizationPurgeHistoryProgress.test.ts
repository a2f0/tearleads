import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  organizationBilling,
  organizationGroupTombstones,
  organizations,
  principalHistoryIndexNodes,
  principalHistoryProgress,
} from "@tearleads/api-shared/schema";
import { eq, inArray, notInArray } from "drizzle-orm";
import invariant from "invariant";
import { registerOrganization } from "../../../test/helpers/organizationPurge";
import { createServiceTestRuntime } from "../../../test/helpers/serviceRuntime";
import { runOrganizationPurgeMaintenance } from "./organizationPurge";

test("organization purge removes its principals' history progress and nothing else", async () => {
  const organizationId = await registerOrganization();
  const untouchedOrganizationId = await registerOrganization();
  const [organization] = await db
    .select({
      adminGroupId: organizations.adminGroupId,
      memberGroupId: organizations.memberGroupId,
    })
    .from(organizations)
    .where(eq(organizations.id, organizationId));
  invariant(organization, "expected organization groups");
  const principalIds = [
    organizationId,
    organization.adminGroupId,
    organization.memberGroupId,
  ];
  const purgedProgress = () =>
    db
      .select()
      .from(principalHistoryProgress)
      .where(inArray(principalHistoryProgress.principalId, principalIds));
  const otherProgress = () =>
    db
      .select()
      .from(principalHistoryProgress)
      .where(notInArray(principalHistoryProgress.principalId, principalIds));
  expect(await purgedProgress()).not.toEqual([]);
  const otherBefore = await otherProgress();
  expect(
    otherBefore.some((row) => row.principalId === untouchedOrganizationId),
  ).toBe(true);
  const indexNodes = await db.select().from(principalHistoryIndexNodes);
  const now = new Date("2099-08-27T12:00:00.000Z");
  await db
    .update(organizationBilling)
    .set({
      disabledAt: new Date(now.getTime() - 2_000),
      purgeAfter: new Date(now.getTime() - 1_000),
      status: "disabled",
    })
    .where(eq(organizationBilling.organizationId, organizationId));

  expect(
    await runOrganizationPurgeMaintenance(createServiceTestRuntime(), {
      now,
      organizationIds: [organizationId],
    }),
  ).toEqual({ claimed: 1, failed: 0, purged: 1 });

  expect(await purgedProgress()).toEqual([]);
  expect(await otherProgress()).toEqual(expect.arrayContaining(otherBefore));
  // Hash-addressed proof nodes and the purged groups' tombstones stay.
  expect(await db.select().from(principalHistoryIndexNodes)).toEqual(
    expect.arrayContaining(indexNodes),
  );
  expect(
    (
      await db
        .select({ groupId: organizationGroupTombstones.groupId })
        .from(organizationGroupTombstones)
        .where(eq(organizationGroupTombstones.organizationId, organizationId))
    )
      .map(({ groupId }) => groupId)
      .sort(),
  ).toEqual([organization.adminGroupId, organization.memberGroupId].sort());
});
