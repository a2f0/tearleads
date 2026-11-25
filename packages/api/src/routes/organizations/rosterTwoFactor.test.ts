import { expect, test } from "bun:test";
import { createTestUser, type TestUser } from "@tearleads/test-utils";
import { ORGANIZATION_TWO_FACTOR_ERROR_CODES } from "@tearleads/validators/response";
import invariant from "invariant";
import { authenticate } from "../../../test/helpers/authenticate";
import { addMemberGroupUser } from "../../../test/helpers/organizationMember";
import { loadOrganizationReadModelSnapshot } from "../../../test/helpers/organizationReadModel";
import { registerAndAuthenticateWithOrganization } from "../../../test/helpers/registerUser";
import {
  enableTwoFactorForTest,
  twoFactorRequest,
} from "../../../test/helpers/twoFactor";
import { routeApp } from "../../routeApp";

async function organizationWithMember(): Promise<{
  readonly actor: TestUser;
  readonly member: TestUser;
  readonly memberOrganizationId: string;
  readonly organizationId: string;
}> {
  const actor = createTestUser();
  const organizationId = await registerAndAuthenticateWithOrganization(actor);
  const member = createTestUser();
  const memberOrganizationId =
    await registerAndAuthenticateWithOrganization(member);
  await addMemberGroupUser({
    actor,
    memberUserId: member.userId,
    organizationId,
  });
  return { actor, member, memberOrganizationId, organizationId };
}

function setRequirement(input: {
  readonly organizationId: string;
  readonly required: boolean;
  readonly token: string;
  readonly userId: string;
}) {
  return routeApp.request(
    `/organizations/${input.organizationId}/roster/${input.userId}/two-factor`,
    {
      body: JSON.stringify({ required: input.required }),
      headers: {
        Authorization: `Bearer ${input.token}`,
        "Content-Type": "application/json",
      },
      method: "PUT",
    },
  );
}

function readModel(organizationId: string, token: string) {
  return routeApp.request(`/organizations/${organizationId}/read-model`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

test("only an administrator sets a member's two-factor requirement", async () => {
  const { actor, member, organizationId } = await organizationWithMember();

  const byMember = await setRequirement({
    organizationId,
    required: true,
    token: member.token,
    userId: member.userId,
  });
  expect(byMember.status).toBe(403);

  const byAdmin = await setRequirement({
    organizationId,
    required: true,
    token: actor.token,
    userId: member.userId,
  });
  expect(byAdmin.status).toBe(200);
  expect(await byAdmin.json()).toMatchObject({
    twoFactorRequired: true,
    userId: member.userId,
  });

  const snapshot = await loadOrganizationReadModelSnapshot(
    actor,
    organizationId,
  );
  const listed = snapshot.lanes.directory.users.find(
    (user) => user.userId === member.userId,
  );
  expect(listed?.twoFactorRequired).toBe(true);

  const missing = await setRequirement({
    organizationId,
    required: true,
    token: actor.token,
    userId: crypto.randomUUID(),
  });
  expect(missing.status).toBe(404);
});

test("a required member is refused the organization until two-factor is on", async () => {
  const { actor, member, memberOrganizationId, organizationId } =
    await organizationWithMember();
  const before = member.token;
  expect((await readModel(organizationId, before)).status).toBe(200);

  await setRequirement({
    organizationId,
    required: true,
    token: actor.token,
    userId: member.userId,
  });

  // The requirement change revoked the member's session without a second factor.
  expect((await readModel(organizationId, before)).status).toBe(401);

  await authenticate(member);
  // The member's status names the organization holding the requirement.
  expect(await (await twoFactorRequest(member.token, "")).json()).toMatchObject(
    { requiredByOrganizationIds: [organizationId], sessionVerified: false },
  );
  const refused = await readModel(organizationId, member.token);
  expect(refused.status).toBe(403);
  expect(await refused.json()).toMatchObject({
    code: ORGANIZATION_TWO_FACTOR_ERROR_CODES.required,
    organizationId,
  });
  // Other organizations stay open, and so does turning two-factor on.
  expect((await readModel(memberOrganizationId, member.token)).status).toBe(
    200,
  );

  await enableTwoFactorForTest(member.token);
  expect((await readModel(organizationId, member.token)).status).toBe(200);
});

test("lifting a requirement keeps sessions that passed a second factor", async () => {
  const { actor, member, organizationId } = await organizationWithMember();
  await enableTwoFactorForTest(member.token);
  await setRequirement({
    organizationId,
    required: true,
    token: actor.token,
    userId: member.userId,
  });
  expect((await readModel(organizationId, member.token)).status).toBe(200);

  const lifted = await setRequirement({
    organizationId,
    required: false,
    token: actor.token,
    userId: member.userId,
  });
  expect(lifted.status).toBe(200);
  const status = await twoFactorRequest(member.token, "");
  expect(status.status).toBe(200);
  invariant(
    (await status.json()).sessionVerified === true,
    "expected the verified session to survive",
  );
});
