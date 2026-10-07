import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { principalPolicyCommits } from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/bob-and-alice";
import { and, eq } from "drizzle-orm";
import { addUserToAdminGroup } from "../../../test/helpers/organizationAdmin";
import { createGroupRequest } from "../../../test/helpers/organizationGroup";
import { requestPreparedPrincipalPolicy } from "../../../test/helpers/principalHistoryRequest";
import {
  buildOrganizationGroupDeletionRequest,
  getDefaultOrganizationId,
} from "../../../test/helpers/principalPolicy";
import { registerAndAuthenticate } from "../../../test/helpers/principalPolicyReadFixtures";

test("a creation receipt belongs to its author and is removed with its group", async () => {
  const actor = createTestUser();
  const secondAdmin = createTestUser();
  await registerAndAuthenticate(actor, secondAdmin);
  const organizationId = await getDefaultOrganizationId(actor.userId);
  await addUserToAdminGroup({ actor, member: secondAdmin, organizationId });
  const groupId = crypto.randomUUID();
  const path = `/organizations/${organizationId}/groups`;
  const headers = {
    Authorization: `Bearer ${actor.token}`,
    "Content-Type": "application/json",
  };
  const body = JSON.stringify(
    await createGroupRequest({ actor, groupId, name: "Receipt scope" }),
  );
  const created = await requestPreparedPrincipalPolicy(path, {
    method: "POST",
    headers,
    body,
  });
  expect(created.status).toBe(200);
  const original = await created.json();
  const second = await requestPreparedPrincipalPolicy(path, {
    method: "POST",
    headers: { ...headers, Authorization: `Bearer ${secondAdmin.token}` },
    body,
  });
  expect(second.status).toBe(409);
  expect(await second.json()).toEqual({
    error: "Group principal already exists",
  });
  const retried = await requestPreparedPrincipalPolicy(path, {
    method: "POST",
    headers,
    body,
  });
  expect(retried.status).toBe(200);
  expect(await retried.json()).toEqual(original);
  const deleted = await requestPreparedPrincipalPolicy(`${path}/${groupId}`, {
    method: "DELETE",
    headers,
    body: JSON.stringify(
      await buildOrganizationGroupDeletionRequest({
        actor,
        groupId,
        organizationId,
      }),
    ),
  });
  expect(deleted.status).toBe(200);
  await deleted.arrayBuffer();
  expect(
    await db
      .select()
      .from(principalPolicyCommits)
      .where(
        and(
          eq(principalPolicyCommits.organizationId, organizationId),
          eq(principalPolicyCommits.groupId, groupId),
        ),
      ),
  ).toHaveLength(0);
  const purged = await requestPreparedPrincipalPolicy(path, {
    method: "POST",
    headers,
    body,
  });
  expect(purged.status).toBe(409);
  expect(await purged.json()).toEqual({
    error: "Deleted organization group IDs cannot be reused",
  });
}, 15_000);
