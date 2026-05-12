import { expect, test } from "bun:test";
import { createTestUser, type TestUser } from "@tearleads/bob-and-alice";
import {
  generateKemSeedAndKeyPair,
  toFingerprint,
  wrapDekForRecipients,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import {
  isListOrganizationGroupsResponse,
  isOrganizationDirectoryResponse,
  isOrganizationGroupMembersResponse,
  isOrganizationGroupSummaryResponse,
} from "@tearleads/validators/response";
import { eq } from "drizzle-orm";
import invariant from "invariant";
import { authenticate } from "../../../test/helpers/authenticate";
import {
  createProjectionWithAdminSigner,
  signPrincipalStateBundle,
} from "../../../test/helpers/principalState";
import { registerUser } from "../../../test/helpers/registerUser";
import { db } from "../../adapters/postgres";
import { routeApp } from "../../routeApp";
import { users } from "../../schema";

async function registerAndAuthenticate(user: TestUser): Promise<string> {
  await registerUser(user);
  await authenticate(user);

  const [row] = await db
    .select({ organizationId: users.defaultOrganizationId })
    .from(users)
    .where(eq(users.id, user.userId));

  invariant(row, "expected registered user row");
  return row.organizationId;
}

async function createGroupRequest(input: {
  actor: TestUser;
  groupId: string;
  name: string;
}) {
  const principalKem = generateKemSeedAndKeyPair();
  const projection = createProjectionWithAdminSigner(input.actor.userId, [
    { principalType: "user", principalId: input.actor.userId },
  ]);
  const payloadCiphertext = bytesToBase64(
    new TextEncoder().encode(JSON.stringify({ members: projection })),
  );
  const state = await signPrincipalStateBundle({
    principalType: "group",
    principalId: input.groupId,
    version: 1,
    prevStateHash: null,
    keyEpoch: 1,
    encapsulationPublicKey: bytesToBase64(principalKem.publicKey),
    keyFingerprint: await toFingerprint(principalKem.publicKey),
    members: [{ principalType: "user", principalId: input.actor.userId }],
    projection,
    payloadCiphertext,
    signedAt: new Date("2026-05-12T12:00:00.000Z").toISOString(),
    signerUserId: input.actor.userId,
    signerUserKeyFingerprint: input.actor.fingerprint,
    signingPrivateKey: input.actor.signing.signingPrivateKey,
  });
  const [memberEnvelope] = await wrapDekForRecipients(principalKem.secretKey, [
    input.actor.kem.publicKey,
  ]);

  invariant(memberEnvelope, "expected member envelope");

  return {
    groupId: input.groupId,
    name: input.name,
    initialGroupPolicy: {
      state: state.state,
      encryptedPayload: state.encryptedPayload,
      projection: state.projection,
      memberEnvelopes: [
        {
          memberPrincipalType: "user" as const,
          memberPrincipalId: input.actor.userId,
          memberKeyFingerprint: await toFingerprint(input.actor.kem.publicKey),
          kemCipherText: bytesToBase64(memberEnvelope.kemCipherText),
          wrappedKey: bytesToBase64(memberEnvelope.wrappedKey),
        },
      ],
    },
  };
}

test("org manager routes list the current org directory", async () => {
  const actor = createTestUser();
  const organizationId = await registerAndAuthenticate(actor);

  const response = await routeApp.request(
    `/organizations/${organizationId}/directory`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${actor.token}` },
    },
  );

  expect(response.status).toBe(200);
  const body = await response.json();
  invariant(
    isOrganizationDirectoryResponse(body),
    "expected organization directory response",
  );
  expect(body.organizationId).toBe(organizationId);
  expect(body.users).toHaveLength(1);
  expect(body.users[0]?.userId).toBe(actor.userId);
  expect(body.users[0]?.role).toBe("admin");
  expect(body.users[0]?.isSelf).toBe(true);
});

test("org manager routes reject users outside the organization", async () => {
  const actor = createTestUser();
  const organizationId = await registerAndAuthenticate(actor);
  const intruder = createTestUser();
  await registerAndAuthenticate(intruder);

  const response = await routeApp.request(
    `/organizations/${organizationId}/directory`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${intruder.token}` },
    },
  );

  expect(response.status).toBe(403);
});

test("org manager routes create and list groups with members", async () => {
  const actor = createTestUser();
  const organizationId = await registerAndAuthenticate(actor);
  const groupId = crypto.randomUUID();

  const createResponse = await routeApp.request(
    `/organizations/${organizationId}/groups`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${actor.token}`,
      },
      body: JSON.stringify(
        await createGroupRequest({
          actor,
          groupId,
          name: "Operators",
        }),
      ),
    },
  );

  expect(createResponse.status).toBe(200);
  const createBody = await createResponse.json();
  invariant(
    isOrganizationGroupSummaryResponse(createBody),
    "expected organization group summary response",
  );
  expect(createBody.groupId).toBe(groupId);
  expect(createBody.name).toBe("Operators");
  expect(createBody.currentState?.memberCount).toBe(1);

  const listResponse = await routeApp.request(
    `/organizations/${organizationId}/groups`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${actor.token}` },
    },
  );
  expect(listResponse.status).toBe(200);
  const listBody = await listResponse.json();
  invariant(
    isListOrganizationGroupsResponse(listBody),
    "expected list organization groups response",
  );
  expect(listBody.groups.map((group) => group.groupId)).toContain(groupId);

  const membersResponse = await routeApp.request(
    `/organizations/${organizationId}/groups/${groupId}/members`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${actor.token}` },
    },
  );
  expect(membersResponse.status).toBe(200);
  const membersBody = await membersResponse.json();
  invariant(
    isOrganizationGroupMembersResponse(membersBody),
    "expected organization group members response",
  );
  expect(membersBody.members).toEqual([
    {
      memberPrincipalType: "user",
      memberPrincipalId: actor.userId,
      role: "admin",
      userId: actor.userId,
      signingKeyFingerprint: actor.fingerprint,
      signingPublicKey: bytesToBase64(actor.signing.signingPublicKey),
      encapsulationPublicKey: bytesToBase64(actor.kem.publicKey),
      encapsulationKeyFingerprint: await toFingerprint(actor.kem.publicKey),
      groupId: null,
      groupName: null,
    },
  ]);
});
