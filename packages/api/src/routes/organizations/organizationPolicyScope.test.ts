import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { groups, organizations, users } from "@tearleads/api-shared/schema";
import { createTestUser, type TestUser } from "@tearleads/bob-and-alice";
import { generateKemSeedAndKeyPair, toFingerprint } from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import { isOrganizationReadModelResponse } from "@tearleads/validators/response";
import { eq } from "drizzle-orm";
import invariant from "invariant";
import { authenticate } from "../../../test/helpers/authenticate";
import { createGroupRequest } from "../../../test/helpers/organizationGroup";
import { createPrincipalMemberEnvelopes } from "../../../test/helpers/principalMemberEnvelopes";
import { signPrincipalStateBundle } from "../../../test/helpers/principalState";
import { registerUser } from "../../../test/helpers/registerUser";
import {
  getCurrentPrincipalState,
  listCurrentPrincipalProjectionMembers,
} from "../../access/read/principalStateStore";
import { routeApp } from "../../routeApp";

const SCOPE_ERROR =
  "Organization policies may only reference groups from the same organization";

async function registerActor(user: TestUser) {
  await registerUser(user);
  await authenticate(user);
  const [row] = await db
    .select({
      adminGroupId: organizations.adminGroupId,
      organizationId: users.defaultOrganizationId,
    })
    .from(users)
    .innerJoin(organizations, eq(organizations.id, users.defaultOrganizationId))
    .where(eq(users.id, user.userId));
  invariant(row, "expected registered organization");
  return row;
}

async function readSnapshot(actor: TestUser, organizationId: string) {
  const response = await routeApp.request(
    `/organizations/${organizationId}/read-model`,
    { headers: { Authorization: `Bearer ${actor.token}` } },
  );
  const body = await response.json();
  invariant(
    isOrganizationReadModelResponse(body) && body.mode === "snapshot",
    "expected organization read-model snapshot",
  );
  return body;
}

async function expectNoChange(
  actor: TestUser,
  organizationId: string,
  cursor: string,
) {
  const response = await routeApp.request(
    `/organizations/${organizationId}/read-model?${new URLSearchParams({ cursor })}`,
    { headers: { Authorization: `Bearer ${actor.token}` } },
  );
  const body = await response.json();
  invariant(
    isOrganizationReadModelResponse(body) && body.mode === "delta",
    "expected organization read-model delta",
  );
  expect(body.lanes).toEqual({});
  expect(body.nextCursor).toBe(cursor);
}

async function postGroup(
  actor: TestUser,
  organizationId: string,
  body: unknown,
) {
  return routeApp.request(`/organizations/${organizationId}/groups`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${actor.token}`,
    },
    body: JSON.stringify(body),
  });
}

test("group creation rejects foreign nested groups without advancing the cursor", async () => {
  const owner = createTestUser();
  const ownerOrganization = await registerActor(owner);
  const foreign = await registerActor(createTestUser());
  const before = await readSnapshot(owner, ownerOrganization.organizationId);
  const groupId = crypto.randomUUID();
  const request = await createGroupRequest({
    actor: owner,
    groupId,
    name: "Cross-org group",
    nestedGroupIds: [foreign.adminGroupId],
  });

  const response = await postGroup(
    owner,
    ownerOrganization.organizationId,
    request,
  );
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: SCOPE_ERROR });
  expect(await db.select().from(groups).where(eq(groups.id, groupId))).toEqual(
    [],
  );
  await expectNoChange(
    owner,
    ownerOrganization.organizationId,
    before.nextCursor,
  );
});

test("policy updates reject foreign nested groups without advancing the cursor", async () => {
  const owner = createTestUser();
  const ownerOrganization = await registerActor(owner);
  const foreign = await registerActor(createTestUser());
  const groupId = crypto.randomUUID();
  const createResponse = await postGroup(
    owner,
    ownerOrganization.organizationId,
    await createGroupRequest({ actor: owner, groupId, name: "Local group" }),
  );
  expect(createResponse.status).toBe(200);
  const before = await readSnapshot(owner, ownerOrganization.organizationId);
  const currentState = await getCurrentPrincipalState("group", groupId, db);
  invariant(currentState, "expected current local group state");
  const currentProjection = await listCurrentPrincipalProjectionMembers(
    "group",
    groupId,
    db,
  );
  const projection = [
    ...currentProjection,
    {
      userId: foreign.adminGroupId,
      role: "member" as const,
    },
  ];
  const principalKem = generateKemSeedAndKeyPair();
  const { memberEnvelopes, stateMembers } =
    await createPrincipalMemberEnvelopes({
      principalSecretKey: principalKem.secretKey,
      projection,
    });
  const policy = await signPrincipalStateBundle({
    principalType: "group",
    principalId: groupId,
    version: currentState.version + 1,
    prevStateHash: currentState.stateHash,
    keyEpoch: currentState.keyEpoch + 1,
    encapsulationPublicKey: bytesToBase64(principalKem.publicKey),
    keyFingerprint: await toFingerprint(principalKem.publicKey),
    members: stateMembers,
    projection,
    payloadCiphertext: bytesToBase64(
      new TextEncoder().encode(JSON.stringify({ members: projection })),
    ),
    signedAt: "2026-07-16T12:00:00.000Z",
    signerUserId: owner.userId,
    signerUserKeyFingerprint: owner.fingerprint,
    signingPrivateKey: owner.signing.signingPrivateKey,
    memberEnvelopes,
  });

  const response = await routeApp.request(
    `/principals/group/${groupId}/policy`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${owner.token}`,
      },
      body: JSON.stringify(policy),
    },
  );
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: SCOPE_ERROR });
  expect(
    (await getCurrentPrincipalState("group", groupId, db))?.stateHash,
  ).toBe(currentState.stateHash);
  await expectNoChange(
    owner,
    ownerOrganization.organizationId,
    before.nextCursor,
  );
});

test("deleted group IDs reject policy replay and catalog reuse", async () => {
  const owner = createTestUser();
  const organization = await registerActor(owner);
  const groupId = crypto.randomUUID();
  const request = await createGroupRequest({
    actor: owner,
    groupId,
    name: "Ephemeral",
  });
  expect(
    (await postGroup(owner, organization.organizationId, request)).status,
  ).toBe(200);
  const deleteResponse = await routeApp.request(
    `/organizations/${organization.organizationId}/groups/${groupId}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${owner.token}` },
    },
  );
  expect(deleteResponse.status).toBe(200);
  const before = await readSnapshot(owner, organization.organizationId);

  const replayResponse = await routeApp.request(
    `/principals/group/${groupId}/policy`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${owner.token}`,
      },
      body: JSON.stringify(request.initialGroupPolicy),
    },
  );
  expect(replayResponse.status).toBe(409);
  expect(await getCurrentPrincipalState("group", groupId, db)).toBeNull();

  const reuseResponse = await postGroup(
    owner,
    organization.organizationId,
    request,
  );
  expect(reuseResponse.status).toBe(409);
  await expectNoChange(owner, organization.organizationId, before.nextCursor);
});
