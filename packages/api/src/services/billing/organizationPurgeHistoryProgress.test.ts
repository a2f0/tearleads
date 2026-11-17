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
import { and, eq, inArray, notInArray, or } from "drizzle-orm";
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

test("organization purge removes the history progress of its principals, deleted groups included, and nothing else, even under a reused id", async () => {
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
  // Hints of other principals that reuse a purged UUID under the other
  // principal type: an organization with a purged group's id, and a group with
  // the purged organization's id. Purge matches type and id, so they stay.
  const [template] = await db
    .select()
    .from(principalHistoryProgress)
    .where(eq(principalHistoryProgress.principalId, untouchedOrganizationId))
    .limit(1);
  invariant(template, "expected another organization's hint");
  const sameIds = await db
    .insert(principalHistoryProgress)
    .values([
      {
        ...template,
        id: crypto.randomUUID(),
        principalId: organization.adminGroupId,
        principalType: "organization",
      },
      {
        ...template,
        id: crypto.randomUUID(),
        principalId: organizationId,
        principalType: "group",
      },
    ])
    .returning({ id: principalHistoryProgress.id });
  const sameIdRows = sameIds.map(({ id }) => id);
  const purgedProgress = () =>
    db
      .select()
      .from(principalHistoryProgress)
      .where(
        and(
          inArray(principalHistoryProgress.principalId, principalIds),
          notInArray(principalHistoryProgress.id, sameIdRows),
        ),
      );
  const otherProgress = () =>
    db
      .select()
      .from(principalHistoryProgress)
      .where(
        or(
          notInArray(principalHistoryProgress.principalId, principalIds),
          inArray(principalHistoryProgress.id, sameIdRows),
        ),
      )
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
  expect(otherBefore.filter(({ id }) => sameIdRows.includes(id))).toHaveLength(
    2,
  );
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
