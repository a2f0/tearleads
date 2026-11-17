import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { principalHistoryProgress } from "@tearleads/api-shared/schema";
import { createTestUser, type TestUser } from "@tearleads/test-utils";
import { and, eq } from "drizzle-orm";
import { authenticate } from "../../../test/helpers/authenticate";
import { prepareUserForAdminGroup } from "../../../test/helpers/organizationAdmin";
import { createGroupRequest } from "../../../test/helpers/organizationGroup";
import {
  getDefaultOrganizationId,
  submitOrganizationGroupPolicyCommit,
} from "../../../test/helpers/principalPolicy";
import { registerUser } from "../../../test/helpers/registerUser";
import { routeApp } from "../../routeApp";

async function authorityProgressVersions(adminGroupId: string) {
  const rows = await db
    .select({ version: principalHistoryProgress.version })
    .from(principalHistoryProgress)
    .where(
      and(
        eq(principalHistoryProgress.principalType, "group"),
        eq(principalHistoryProgress.principalId, adminGroupId),
        eq(principalHistoryProgress.verificationKind, "authority"),
      ),
    );
  return rows.map(({ version }) => version).sort();
}

async function createGovernedGroup(actor: TestUser, organizationId: string) {
  const groupId = crypto.randomUUID();
  // The raw route: a 202 preparation round would fail the status check.
  return routeApp.request(`/organizations/${organizationId}/groups`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${actor.token}`,
    },
    body: JSON.stringify(
      await createGroupRequest({
        actor,
        groupId,
        includeActorAsAdmin: false,
        name: `Governed ${groupId}`,
      }),
    ),
  });
}

test("each stored Admins head publishes its strict authority progress", async () => {
  const actor = createTestUser();
  const admin = createTestUser();
  await registerUser(actor);
  await registerUser(admin);
  await authenticate(actor);
  const organizationId = await getDefaultOrganizationId(actor.userId);
  const prepared = await prepareUserForAdminGroup({
    actor,
    member: admin,
    organizationId,
  });
  expect(await authorityProgressVersions(prepared.adminGroupId)).toEqual([1]);
  expect((await createGovernedGroup(actor, organizationId)).status).toBe(200);

  const committed = await submitOrganizationGroupPolicyCommit({
    actor,
    groupId: prepared.adminGroupId,
    groupPolicy: prepared.request,
    organizationId,
    request: (path, init) => routeApp.request(path, init),
  });
  expect(committed.status).toBe(200);
  expect(await authorityProgressVersions(prepared.adminGroupId)).toEqual([
    1, 2,
  ]);
  expect((await createGovernedGroup(actor, organizationId)).status).toBe(200);
});
