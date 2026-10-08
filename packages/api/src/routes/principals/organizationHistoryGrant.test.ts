import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { createTestUser, type TestUser } from "@tearleads/bob-and-alice";
import {
  addMemberGroupUser,
  removeMemberGroupUser,
} from "../../../test/helpers/organizationMember";
import { getDefaultOrganizationId } from "../../../test/helpers/organizationMembership";
import { registerAndAuthenticate } from "../../../test/helpers/principalPolicyReadFixtures";
import { getCurrentPrincipalState } from "../../access/read/principalStateStore";
import { routeApp } from "../../routeApp";
import { principalHistoryHead } from "../../workflows/principals/principalHistoryRecords";
import { issueProjectionPolicyHistoryGrant } from "../../workflows/principals/projectionPolicyHistoryGrant";

function readPage(actor: TestUser, grant: string) {
  return routeApp.request(
    `/principals/history?${new URLSearchParams({ grant })}`,
    { headers: { Authorization: `Bearer ${actor.token}` } },
  );
}

test("organization history grants recheck live roster access and exact organization scope", async () => {
  const owner = createTestUser();
  const member = createTestUser();
  const outsider = createTestUser();
  await registerAndAuthenticate(owner, member, outsider);
  const organizationId = await getDefaultOrganizationId(owner.userId);
  await addMemberGroupUser({
    actor: owner,
    memberUserId: member.userId,
    organizationId,
  });
  const state = await getCurrentPrincipalState(
    "organization",
    organizationId,
    db,
  );
  if (!state) throw new Error("Missing directory");
  const scope = {
    organizationId,
    objectKind: "organization" as const,
    objectId: organizationId,
    userId: member.userId,
    head: principalHistoryHead(state),
  };
  const grant = issueProjectionPolicyHistoryGrant(scope);
  const response = await readPage(member, grant);
  expect(response.status, await response.clone().text()).toBe(200);
  expect((await readPage(outsider, grant)).status).toBe(403);
  const wrongScope = issueProjectionPolicyHistoryGrant({
    ...scope,
    objectId: crypto.randomUUID(),
  });
  expect((await readPage(member, wrongScope)).status).toBe(403);
  await removeMemberGroupUser({
    actor: owner,
    memberUserId: member.userId,
    organizationId,
  });
  expect((await readPage(member, grant)).status).toBe(403);
}, 15_000);
