import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { computePrincipalMemberEnvelopesRoot } from "@tearleads/crypto";
import { createTestUser, type TestUser } from "@tearleads/test-utils";
import { getPrincipalMemberEnvelopesOperation } from "@tearleads/validators/operation";
import { addMemberGroupUser } from "../../../test/helpers/organizationMember";
import { loadOrganizationGroups } from "../../../test/helpers/principalPolicyReadFixtures";
import { requestAfterPrincipalPreparation } from "../../../test/helpers/principalPreparationRequest";
import { registerAndAuthenticateWithOrganization } from "../../../test/helpers/registerUser";
import { getCurrentPrincipalState } from "../../access/read/principalStateStore";

function getMemberEnvelopes(
  actor: Pick<TestUser, "token">,
  principalId: string,
  stateHash: string,
): Promise<Response> {
  return requestAfterPrincipalPreparation(
    `/principals/group/${principalId}/policy/member-envelopes?stateHash=${stateHash}`,
    { headers: { Authorization: `Bearer ${actor.token}` }, method: "GET" },
  );
}

test("GET member envelopes serves a historical Members state that recomputes its signed root", async () => {
  const owner = createTestUser();
  const member = createTestUser();
  const stranger = createTestUser();
  const organizationId = await registerAndAuthenticateWithOrganization(owner);
  await registerAndAuthenticateWithOrganization(member);
  await registerAndAuthenticateWithOrganization(stranger);
  const { adminGroupId, memberGroupId } =
    await loadOrganizationGroups(organizationId);
  const historical = await getCurrentPrincipalState("group", memberGroupId, db);
  const admins = await getCurrentPrincipalState("group", adminGroupId, db);
  if (!historical || !admins) throw new Error("expected group states");

  await addMemberGroupUser({
    actor: owner,
    memberUserId: member.userId,
    organizationId,
  });
  const current = await getCurrentPrincipalState("group", memberGroupId, db);
  expect(current?.stateHash).not.toBe(historical.stateHash);

  const response = await getMemberEnvelopes(
    owner,
    memberGroupId,
    historical.stateHash,
  );
  expect(response.status, await response.clone().text()).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  const body = getPrincipalMemberEnvelopesOperation.responses[200].parse(
    await response.json(),
  );
  expect(body).toMatchObject({
    epoch: historical.keyEpoch,
    principalId: memberGroupId,
    principalType: "group",
    stateHash: historical.stateHash,
  });
  expect(body.envelopes.map((envelope) => envelope.userId)).toEqual([
    owner.userId,
  ]);
  expect(await computePrincipalMemberEnvelopesRoot(body.envelopes)).toBe(
    historical.memberEnvelopesRoot,
  );

  // The member who joined later is an active roster member too.
  expect(
    (await getMemberEnvelopes(member, memberGroupId, historical.stateHash))
      .status,
  ).toBe(200);

  const denied = await getMemberEnvelopes(
    stranger,
    memberGroupId,
    historical.stateHash,
  );
  expect(denied.status).toBe(403);
  expect(await denied.json()).toEqual({
    error: "Principal policy access denied",
  });

  for (const stateHash of ["0".repeat(64), admins.stateHash]) {
    const missing = await getMemberEnvelopes(owner, memberGroupId, stateHash);
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({
      error: "Principal state not found",
    });
  }
  // Authorization comes first: a stranger cannot probe which states exist.
  expect(
    (await getMemberEnvelopes(stranger, memberGroupId, "0".repeat(64))).status,
  ).toBe(403);
});

test("GET member envelopes rejects a malformed state hash", async () => {
  const owner = createTestUser();
  const organizationId = await registerAndAuthenticateWithOrganization(owner);
  const { memberGroupId } = await loadOrganizationGroups(organizationId);
  for (const stateHash of ["A".repeat(64), "0".repeat(63), ""]) {
    const response = await getMemberEnvelopes(owner, memberGroupId, stateHash);
    expect(response.status).toBe(400);
  }
});
