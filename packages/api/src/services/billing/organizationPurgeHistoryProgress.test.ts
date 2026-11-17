import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  organizationBilling,
  organizationGroupTombstones,
  organizations,
  principalHistoryIndexNodes,
  principalHistoryProgress,
} from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/test-utils";
import { eq, inArray, notInArray } from "drizzle-orm";
import invariant from "invariant";
import { authenticate } from "../../../test/helpers/authenticate";
import {
  createGroupRequest,
  deleteGroupRequest,
} from "../../../test/helpers/organizationGroup";
import { registerOrganization } from "../../../test/helpers/organizationPurge";
import { requestPreparedPrincipalPolicy } from "../../../test/helpers/principalHistoryRequest";
import { getDefaultOrganizationId } from "../../../test/helpers/principalPolicy";
import { registerUser } from "../../../test/helpers/registerUser";
import { createServiceTestRuntime } from "../../../test/helpers/serviceRuntime";
import { runOrganizationPurgeMaintenance } from "./organizationPurge";

/** A group created and deleted before the purge: it keeps its hints. */
async function organizationWithDeletedGroup() {
  const actor = createTestUser();
  await registerUser(actor);
  await authenticate(actor);
  const organizationId = await getDefaultOrganizationId(actor.userId);
  const groupId = crypto.randomUUID();
  const created = await requestPreparedPrincipalPolicy(
    `/organizations/${organizationId}/groups`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${actor.token}`,
      },
      body: JSON.stringify(
        await createGroupRequest({ actor, groupId, name: "Deleted early" }),
      ),
    },
  );
  expect(created.status).toBe(200);
  expect(
    (await deleteGroupRequest({ actor, groupId, organizationId })).status,
  ).toBe(200);
  return { deletedGroupId: groupId, organizationId };
}

test("organization purge removes the history progress of its principals, deleted groups included, and nothing else", async () => {
  const { deletedGroupId, organizationId } =
    await organizationWithDeletedGroup();
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
    deletedGroupId,
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
      .where(notInArray(principalHistoryProgress.principalId, principalIds))
      .orderBy(principalHistoryProgress.id);
  const before = await purgedProgress();
  expect(new Set(before.map(({ principalId }) => principalId))).toEqual(
    new Set(principalIds),
  );
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
  expect(await otherProgress()).toEqual(otherBefore);
  // Hash-addressed proof nodes and every group's tombstone stay.
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
  ).toEqual(
    [
      organization.adminGroupId,
      organization.memberGroupId,
      deletedGroupId,
    ].sort(),
  );
});
