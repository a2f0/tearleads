import { expect, test } from "bun:test";
import { createTestUser, type TestUser } from "@tearleads/bob-and-alice";
import {
  generateKemSeedAndKeyPair,
  normalizePrincipalProjectionMembers,
  toFingerprint,
  wrapDekForRecipients,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import {
  isListOrganizationGroupsResponse,
  isOrganizationContainerGrantsResponse,
  isOrganizationDirectoryResponse,
  isOrganizationGroupContainersResponse,
  isOrganizationGroupMembersResponse,
  isOrganizationGroupSummaryResponse,
} from "@tearleads/validators/response";
import { and, eq, isNull } from "drizzle-orm";
import invariant from "invariant";
import { authenticate } from "../../../test/helpers/authenticate";
import {
  createProjectionWithAdminSigner,
  signPrincipalStateBundle,
} from "../../../test/helpers/principalState";
import { registerUser } from "../../../test/helpers/registerUser";
import {
  getCurrentPrincipalState,
  listCurrentPrincipalProjectionMembers,
} from "../../access/read/principalStateStore";
import { storeVerifiedPrincipalState } from "../../access/write/principalStateStore";
import { db } from "../../adapters/postgres";
import { routeApp } from "../../routeApp";
import { containers, organizations, users } from "../../schema";

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

async function addMemberGroupUser(input: {
  actor: TestUser;
  memberUserId: string;
  organizationId: string;
}) {
  const [organization] = await db
    .select({ memberGroupId: organizations.memberGroupId })
    .from(organizations)
    .where(eq(organizations.id, input.organizationId))
    .limit(1);
  invariant(organization, "expected organization row");

  const currentState = await getCurrentPrincipalState(
    "group",
    organization.memberGroupId,
    db,
  );
  invariant(currentState, "expected current member group state");

  const currentProjection = await listCurrentPrincipalProjectionMembers(
    "group",
    organization.memberGroupId,
    db,
  );
  const projection = normalizePrincipalProjectionMembers([
    ...currentProjection.map((member) => ({
      memberPrincipalType: member.memberPrincipalType,
      memberPrincipalId: member.memberPrincipalId,
      role: member.role,
    })),
    {
      memberPrincipalType: "user" as const,
      memberPrincipalId: input.memberUserId,
      role: "member" as const,
    },
  ]);
  const payloadCiphertext = bytesToBase64(
    new TextEncoder().encode(JSON.stringify({ members: projection })),
  );
  const state = await signPrincipalStateBundle({
    principalType: "group",
    principalId: organization.memberGroupId,
    version: currentState.version + 1,
    prevStateHash: currentState.stateHash,
    keyEpoch: currentState.keyEpoch,
    encapsulationPublicKey: currentState.encapsulationPublicKey,
    keyFingerprint: currentState.keyFingerprint,
    members: projection.map((member) => ({
      principalType: member.memberPrincipalType,
      principalId: member.memberPrincipalId,
    })),
    projection,
    payloadCiphertext,
    signedAt: new Date("2026-05-12T12:00:00.000Z").toISOString(),
    signerUserId: input.actor.userId,
    signerUserKeyFingerprint: input.actor.fingerprint,
    signingPrivateKey: input.actor.signing.signingPrivateKey,
  });

  await storeVerifiedPrincipalState(state, db);
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
  expect(body.currentUser.isOrgAdmin).toBe(true);
  expect(body.users).toHaveLength(1);
  expect(body.users[0]?.userId).toBe(actor.userId);
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

test("org manager routes list the bootstrap Admins group", async () => {
  const actor = createTestUser();
  const organizationId = await registerAndAuthenticate(actor);
  const [organization] = await db
    .select({
      adminGroupId: organizations.adminGroupId,
      memberGroupId: organizations.memberGroupId,
    })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  invariant(organization, "expected organization row");

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
  expect(listBody.groups.map((group) => group.groupId)).toEqual([
    organization.adminGroupId,
  ]);
  expect(listBody.groups.map((group) => group.groupId)).not.toContain(
    organization.memberGroupId,
  );
  expect(listBody.groups.map((group) => group.name)).toEqual(["Admins"]);
  expect(listBody.groups[0]?.currentState?.memberCount).toBe(1);
});

test("org manager routes list containers directly granted to a group", async () => {
  const actor = createTestUser();
  const organizationId = await registerAndAuthenticate(actor);
  const [organization] = await db
    .select({
      adminGroupId: organizations.adminGroupId,
      memberGroupId: organizations.memberGroupId,
    })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  invariant(organization, "expected organization row");
  const [rootContainer] = await db
    .select({ id: containers.id })
    .from(containers)
    .where(
      and(
        eq(containers.organizationId, organizationId),
        isNull(containers.parentId),
      ),
    )
    .limit(1);
  invariant(rootContainer, "expected root container row");

  const adminResponse = await routeApp.request(
    `/organizations/${organizationId}/groups/${organization.adminGroupId}/containers`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${actor.token}` },
    },
  );

  expect(adminResponse.status).toBe(200);
  const adminBody = await adminResponse.json();
  invariant(
    isOrganizationGroupContainersResponse(adminBody),
    "expected group containers response",
  );
  expect(adminBody.groupId).toBe(organization.adminGroupId);
  expect(
    adminBody.containers.map((container) => ({
      accessLevel: container.accessLevel,
      containerId: container.containerId,
      parentId: container.parentId,
    })),
  ).toContainEqual({
    accessLevel: "admin",
    containerId: rootContainer.id,
    parentId: null,
  });

  const memberResponse = await routeApp.request(
    `/organizations/${organizationId}/groups/${organization.memberGroupId}/containers`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${actor.token}` },
    },
  );

  expect(memberResponse.status).toBe(200);
  const memberBody = await memberResponse.json();
  invariant(
    isOrganizationGroupContainersResponse(memberBody),
    "expected member group containers response",
  );
  expect(memberBody.containers).toEqual([]);
});

test("org manager routes list organization container grants", async () => {
  const actor = createTestUser();
  const organizationId = await registerAndAuthenticate(actor);
  const [organization] = await db
    .select({
      adminGroupId: organizations.adminGroupId,
    })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  invariant(organization, "expected organization row");
  const [rootContainer] = await db
    .select({ id: containers.id })
    .from(containers)
    .where(
      and(
        eq(containers.organizationId, organizationId),
        isNull(containers.parentId),
      ),
    )
    .limit(1);
  invariant(rootContainer, "expected root container row");

  const response = await routeApp.request(
    `/organizations/${organizationId}/grants`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${actor.token}` },
    },
  );

  expect(response.status).toBe(200);
  const body = await response.json();
  invariant(
    isOrganizationContainerGrantsResponse(body),
    "expected organization grants response",
  );
  expect(body.organizationId).toBe(organizationId);
  expect(
    body.grants.map((grant) => ({
      accessLevel: grant.accessLevel,
      containerId: grant.containerId,
      groupId: grant.groupId,
      groupName: grant.groupName,
      subjectId: grant.subjectId,
      subjectType: grant.subjectType,
    })),
  ).toContainEqual({
    accessLevel: "admin",
    containerId: rootContainer.id,
    groupId: organization.adminGroupId,
    groupName: "Admins",
    subjectId: organization.adminGroupId,
    subjectType: "group",
  });
});

test("org manager routes allow organization members to read but reserve mutations for Admins members", async () => {
  const actor = createTestUser();
  const organizationId = await registerAndAuthenticate(actor);
  const member = createTestUser();
  await registerAndAuthenticate(member);
  await addMemberGroupUser({
    actor,
    memberUserId: member.userId,
    organizationId,
  });

  const directoryResponse = await routeApp.request(
    `/organizations/${organizationId}/directory`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${member.token}` },
    },
  );

  expect(directoryResponse.status).toBe(200);
  const directoryBody = await directoryResponse.json();
  invariant(
    isOrganizationDirectoryResponse(directoryBody),
    "expected organization directory response",
  );
  expect(directoryBody.currentUser.isOrgAdmin).toBe(false);
  expect(directoryBody.users.map((user) => user.userId)).toEqual(
    [actor.userId, member.userId].sort(),
  );

  const createResponse = await routeApp.request(
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
  expect(listBody.groups.map((group) => group.name)).toEqual([
    "Admins",
    "Operators",
  ]);

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
