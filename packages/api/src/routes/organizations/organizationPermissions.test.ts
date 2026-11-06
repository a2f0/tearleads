import { expect, test } from "bun:test";
import { createTestUser } from "@tearleads/test-utils";
import { createGroupRequest } from "../../../test/helpers/organizationGroup";
import { addMemberGroupUser } from "../../../test/helpers/organizationMember";
import { loadOrganizationReadModelSnapshot } from "../../../test/helpers/organizationReadModel";
import { requestAfterPrincipalPreparation } from "../../../test/helpers/principalPreparationRequest";
import { registerAndAuthenticateWithOrganization } from "../../../test/helpers/registerUser";
import { routeApp } from "../../routeApp";

test("org manager routes reject users outside the organization", async () => {
  const actor = createTestUser();
  const organizationId = await registerAndAuthenticateWithOrganization(actor);
  const intruder = createTestUser();
  await registerAndAuthenticateWithOrganization(intruder);

  const response = await routeApp.request(
    `/organizations/${organizationId}/read-model`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${intruder.token}` },
    },
  );

  expect(response.status).toBe(403);
});

test("org manager routes allow organization members to read but reserve mutations for Admins members", async () => {
  const actor = createTestUser();
  const organizationId = await registerAndAuthenticateWithOrganization(actor);
  const member = createTestUser();
  await registerAndAuthenticateWithOrganization(member);
  await addMemberGroupUser({
    actor,
    memberUserId: member.userId,
    organizationId,
  });

  const memberSnapshot = await loadOrganizationReadModelSnapshot(
    member,
    organizationId,
  );
  const directoryBody = memberSnapshot.lanes.directory;
  expect(memberSnapshot.currentUser.isOrgAdmin).toBe(false);
  expect(directoryBody.users.map((user) => user.userId)).toEqual(
    [actor.userId, member.userId].sort(),
  );

  const createResponse = await requestAfterPrincipalPreparation(
    `/organizations/${organizationId}/groups`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${member.token}`,
      },
      body: JSON.stringify(
        await createGroupRequest({
          actor: member,
          groupId: crypto.randomUUID(),
          name: "Operators",
        }),
      ),
    },
  );

  expect(createResponse.status).toBe(403);

  const selfRosterResponse = await routeApp.request(
    `/organizations/${organizationId}/roster/${member.userId}`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${member.token}`,
      },
      body: JSON.stringify({ profileDocumentId: null }),
    },
  );
  expect(selfRosterResponse.status).toBe(200);

  const otherRosterResponse = await routeApp.request(
    `/organizations/${organizationId}/roster/${actor.userId}`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${member.token}`,
      },
      body: JSON.stringify({ profileDocumentId: null }),
    },
  );
  expect(otherRosterResponse.status).toBe(403);

  const organizationProfileResponse = await routeApp.request(
    `/organizations/${organizationId}/profile`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${member.token}`,
      },
      body: JSON.stringify({ profileDocumentId: null }),
    },
  );
  expect(organizationProfileResponse.status).toBe(403);
});
