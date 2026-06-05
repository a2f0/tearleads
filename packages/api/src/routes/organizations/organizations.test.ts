import { expect, test } from "bun:test";
import { createTestUser, type TestUser } from "@tearleads/bob-and-alice";
import {
  CONTENT_RECORD_ENCRYPTION_SUITE,
  generateKemSeedAndKeyPair,
  normalizePrincipalProjectionMembers,
  toFingerprint,
  type WriteHeader,
  wrapDekForRecipients,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import type { PrincipalMemberEnvelopeRequest } from "@tearleads/validators/request";
import {
  isDeleteOrganizationGroupResponse,
  isListOrganizationGroupsResponse,
  isOrganizationContainerGrantsResponse,
  isOrganizationDataUsageResponse,
  isOrganizationDirectoryResponse,
  isOrganizationDirectoryUserResponse,
  isOrganizationGroupContainersResponse,
  isOrganizationGroupMembersResponse,
  isOrganizationGroupSummaryResponse,
  isOrganizationProfileResponse,
  isOrganizationUserDetailResponse,
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
import {
  accessManifestHeads,
  blobContentWriteHeaders,
  blobs,
  containers,
  documentContentWriteHeaders,
  documents,
  documentUpdates,
  organizationRosterEntries,
  organizations,
  users,
} from "../../schema";

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
  includeActorAsAdmin?: boolean | undefined;
  name: string;
}) {
  const principalKem = generateKemSeedAndKeyPair();
  const includeActorAsAdmin = input.includeActorAsAdmin ?? true;
  const projection = includeActorAsAdmin
    ? createProjectionWithAdminSigner(input.actor.userId, [
        { principalType: "user", principalId: input.actor.userId },
      ])
    : [];
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
  const memberEnvelopes: PrincipalMemberEnvelopeRequest[] = [];

  if (includeActorAsAdmin) {
    const [memberEnvelope] = await wrapDekForRecipients(
      principalKem.secretKey,
      [input.actor.kem.publicKey],
    );

    invariant(memberEnvelope, "expected member envelope");
    memberEnvelopes.push({
      memberPrincipalType: "user" as const,
      memberPrincipalId: input.actor.userId,
      memberKeyFingerprint: await toFingerprint(input.actor.kem.publicKey),
      kemCipherText: bytesToBase64(memberEnvelope.kemCipherText),
      wrappedKey: bytesToBase64(memberEnvelope.wrappedKey),
    });
  }

  return {
    groupId: input.groupId,
    name: input.name,
    initialGroupPolicy: {
      state: state.state,
      encryptedPayload: state.encryptedPayload,
      projection: state.projection,
      memberEnvelopes,
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

function createUsageWriteHeader(input: {
  contentRecordId: string;
  objectId: string;
  objectKind: "blob" | "document";
  organizationId: string;
  writerUserId: string;
}): WriteHeader {
  return {
    version: 1,
    organizationId: input.organizationId,
    objectKind: input.objectKind,
    objectId: input.objectId,
    accessManifestHash: `${input.contentRecordId}:manifest`,
    contentKeyEpoch: 1,
    targetHash: `${input.contentRecordId}:target`,
    encryptionSuite: CONTENT_RECORD_ENCRYPTION_SUITE,
    contentRecordId: input.contentRecordId,
    nonceDomainHash: `${input.contentRecordId}:nonce`,
    metadataHash: `${input.contentRecordId}:metadata`,
    ciphertextHash: `${input.contentRecordId}:ciphertext`,
    writerUserId: input.writerUserId,
    writerDeviceId: "test-device",
    writerKeyFingerprint: "test-writer-key",
    signedAt: "2026-05-12T12:00:00.000Z",
    signature: `${input.contentRecordId}:signature`,
  };
}

async function seedOrganizationDataUsage(input: {
  actor: TestUser;
  organizationId: string;
}) {
  const documentId = crypto.randomUUID();
  const firstUpdateId = crypto.randomUUID();
  const secondUpdateId = crypto.randomUUID();
  const blobId = crypto.randomUUID();

  await db.insert(documents).values({
    id: documentId,
    createdByFingerprint: input.actor.fingerprint,
  });
  await db.insert(documentUpdates).values([
    {
      id: firstUpdateId,
      documentId,
      accessEpoch: 1,
      authorFingerprint: input.actor.fingerprint,
      encryptedData: "encrypted-document-update-one",
      byteLength: 11,
      partialStartVersionVector: "doc-start-1",
      partialEndVersionVector: "doc-end-1",
    },
    {
      id: secondUpdateId,
      documentId,
      accessEpoch: 1,
      authorFingerprint: input.actor.fingerprint,
      encryptedData: "encrypted-document-update-two",
      byteLength: 13,
      partialStartVersionVector: "doc-start-2",
      partialEndVersionVector: "doc-end-2",
    },
  ]);
  await db.insert(documentContentWriteHeaders).values(
    [firstUpdateId, secondUpdateId].map((updateId, index) => {
      const contentRecordId = `${updateId}:record`;
      const header = createUsageWriteHeader({
        contentRecordId,
        objectId: documentId,
        objectKind: "document",
        organizationId: input.organizationId,
        writerUserId: input.actor.userId,
      });

      return {
        updateId,
        documentId,
        organizationId: input.organizationId,
        contentKeyEpoch: 1,
        accessManifestHash: header.accessManifestHash,
        targetHash: header.targetHash,
        encryptionSuite: header.encryptionSuite,
        contentRecordId: header.contentRecordId,
        nonceDomainHash: header.nonceDomainHash,
        headerHash: `${updateId}:header:${index}`,
        header,
      };
    }),
  );

  await db.insert(blobs).values({
    id: blobId,
    storageKey: `${blobId}:storage`,
    encryptedBytes: "encrypted-blob-bytes",
    sha256: `${blobId}:sha256`,
    byteLength: 17,
  });
  await db.insert(blobContentWriteHeaders).values(
    [crypto.randomUUID(), crypto.randomUUID()].map((recordId, index) => {
      const contentRecordId = `${recordId}:record`;
      const header = createUsageWriteHeader({
        contentRecordId,
        objectId: blobId,
        objectKind: "blob",
        organizationId: input.organizationId,
        writerUserId: input.actor.userId,
      });

      return {
        recordId,
        blobId,
        organizationId: input.organizationId,
        contentKeyEpoch: 1,
        accessManifestHash: header.accessManifestHash,
        targetHash: header.targetHash,
        encryptionSuite: header.encryptionSuite,
        contentRecordId: header.contentRecordId,
        nonceDomainHash: header.nonceDomainHash,
        headerHash: `${recordId}:header:${index}`,
        header,
      };
    }),
  );

  return {
    blobs: { blobCount: 1, byteLength: 17 },
    documents: { byteLength: 24, documentCount: 1, updateCount: 2 },
    totalByteLength: 41,
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
  expect(body.profileDocumentId).toBeNull();
  expect(body.currentUser.isOrgAdmin).toBe(true);
  expect(body.users).toHaveLength(1);
  expect(body.users[0]?.userId).toBe(actor.userId);
  expect(body.users[0]?.isSelf).toBe(true);
  expect(body.users[0]?.status).toBe("active");
  expect(body.users[0]?.profileDocumentId).toBeNull();
  expect(body.users[0]?.disabledAt).toBeNull();
});

test("org manager routes keep disabled roster entries visible outside access groups", async () => {
  const actor = createTestUser();
  const organizationId = await registerAndAuthenticate(actor);
  const disabledUser = createTestUser();
  await registerAndAuthenticate(disabledUser);
  const disabledAt = new Date("2026-05-13T12:00:00.000Z");

  await db.insert(organizationRosterEntries).values({
    organizationId,
    userId: disabledUser.userId,
    status: "disabled",
    disabledAt,
    disabledByUserId: actor.userId,
  });

  const directoryResponse = await routeApp.request(
    `/organizations/${organizationId}/directory`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${actor.token}` },
    },
  );

  expect(directoryResponse.status).toBe(200);
  const directoryBody = await directoryResponse.json();
  invariant(
    isOrganizationDirectoryResponse(directoryBody),
    "expected organization directory response",
  );
  expect(
    directoryBody.users.map((user) => ({
      disabledByUserId: user.disabledByUserId,
      status: user.status,
      userId: user.userId,
    })),
  ).toContainEqual({
    disabledByUserId: actor.userId,
    status: "disabled",
    userId: disabledUser.userId,
  });

  const detailResponse = await routeApp.request(
    `/organizations/${organizationId}/users/${disabledUser.userId}/detail`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${actor.token}` },
    },
  );

  expect(detailResponse.status).toBe(200);
  const detailBody = await detailResponse.json();
  invariant(
    isOrganizationUserDetailResponse(detailBody),
    "expected organization user detail response",
  );
  expect(detailBody.user.status).toBe("disabled");
  expect(detailBody.groups).toEqual([]);
  expect(detailBody.grants.directGrants).toEqual([]);
  expect(detailBody.grants.groupGrants).toEqual([]);

  const disabledUserDirectoryResponse = await routeApp.request(
    `/organizations/${organizationId}/directory`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${disabledUser.token}` },
    },
  );
  expect(disabledUserDirectoryResponse.status).toBe(403);
});

test("org manager routes let admins bind an encrypted roster profile document", async () => {
  const actor = createTestUser();
  const organizationId = await registerAndAuthenticate(actor);

  const response = await routeApp.request(
    `/organizations/${organizationId}/roster/${actor.userId}`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${actor.token}`,
      },
      body: JSON.stringify({ profileDocumentId: null }),
    },
  );

  expect(response.status).toBe(200);
  const body = await response.json();
  invariant(
    isOrganizationDirectoryUserResponse(body),
    "expected organization roster user response",
  );
  expect(body.userId).toBe(actor.userId);
  expect(body.profileDocumentId).toBeNull();
  expect(body.status).toBe("active");
});

test("org manager routes let admins bind an encrypted organization profile document", async () => {
  const actor = createTestUser();
  const organizationId = await registerAndAuthenticate(actor);
  const profileDocumentId = crypto.randomUUID();

  await db.insert(accessManifestHeads).values({
    objectKind: "document",
    objectId: profileDocumentId,
    organizationId,
    epoch: 1,
    manifestHash: `organization-profile-manifest:${crypto.randomUUID()}`,
  });

  const response = await routeApp.request(
    `/organizations/${organizationId}/profile`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${actor.token}`,
      },
      body: JSON.stringify({ profileDocumentId }),
    },
  );

  expect(response.status).toBe(200);
  const body = await response.json();
  invariant(
    isOrganizationProfileResponse(body),
    "expected organization profile response",
  );
  expect(body).toEqual({
    organizationId,
    profileDocumentId,
  });

  const directoryResponse = await routeApp.request(
    `/organizations/${organizationId}/directory`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${actor.token}` },
    },
  );
  const directoryBody = await directoryResponse.json();
  invariant(
    isOrganizationDirectoryResponse(directoryBody),
    "expected organization directory response",
  );
  expect(directoryBody.profileDocumentId).toBe(profileDocumentId);
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
  expect(listBody.groups[0]?.isBuiltin).toBe(true);
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
      isBuiltin: container.isBuiltin,
      parentId: container.parentId,
    })),
  ).toContainEqual({
    accessLevel: "admin",
    containerId: rootContainer.id,
    isBuiltin: true,
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
      isBuiltin: grant.isBuiltin,
      subjectId: grant.subjectId,
      subjectType: grant.subjectType,
    })),
  ).toContainEqual({
    accessLevel: "admin",
    containerId: rootContainer.id,
    groupId: organization.adminGroupId,
    groupName: "Admins",
    isBuiltin: true,
    subjectId: organization.adminGroupId,
    subjectType: "group",
  });
});

test("org manager routes report organization data usage", async () => {
  const actor = createTestUser();
  const organizationId = await registerAndAuthenticate(actor);
  const expectedUsage = await seedOrganizationDataUsage({
    actor,
    organizationId,
  });

  const response = await routeApp.request(
    `/organizations/${organizationId}/data-usage`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${actor.token}` },
    },
  );

  expect(response.status).toBe(200);
  const body = await response.json();
  invariant(
    isOrganizationDataUsageResponse(body),
    "expected organization data usage response",
  );
  expect(body).toEqual({
    organizationId,
    ...expectedUsage,
  });
});

test("org manager routes read user detail with groups and grants", async () => {
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
    `/organizations/${organizationId}/users/${actor.userId}/detail`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${actor.token}` },
    },
  );

  expect(response.status).toBe(200);
  const body = await response.json();
  invariant(
    isOrganizationUserDetailResponse(body),
    "expected organization user detail response",
  );
  expect(body.organizationId).toBe(organizationId);
  expect(body.user.userId).toBe(actor.userId);
  expect(body.user.isSelf).toBe(true);
  expect(body.groups.map((group) => group.groupId)).toContain(
    organization.adminGroupId,
  );
  expect(
    body.grants.groupGrants.map((grant) => ({
      accessLevel: grant.accessLevel,
      containerId: grant.containerId,
      groupId: grant.groupId,
      isBuiltin: grant.isBuiltin,
      subjectId: grant.subjectId,
      subjectType: grant.subjectType,
    })),
  ).toContainEqual({
    accessLevel: "admin",
    containerId: rootContainer.id,
    groupId: organization.adminGroupId,
    isBuiltin: true,
    subjectId: organization.adminGroupId,
    subjectType: "group",
  });
  expect(body.grants.directGrants).toEqual([]);
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

test("org manager routes let admins create empty externally-administered groups", async () => {
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
          includeActorAsAdmin: false,
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
  expect(createBody.isBuiltin).toBe(false);
  expect(createBody.currentState?.memberCount).toBe(0);

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
  expect(membersBody.members).toEqual([]);
});

test("org manager routes create and list groups with members", async () => {
  const actor = createTestUser();
  const organizationId = await registerAndAuthenticate(actor);
  const [organization] = await db
    .select({ adminGroupId: organizations.adminGroupId })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  invariant(organization, "expected organization row");
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
  expect(createBody.isBuiltin).toBe(false);
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

  const builtinDeleteResponse = await routeApp.request(
    `/organizations/${organizationId}/groups/${organization.adminGroupId}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${actor.token}` },
    },
  );
  expect(builtinDeleteResponse.status).toBe(409);

  const deleteResponse = await routeApp.request(
    `/organizations/${organizationId}/groups/${groupId}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${actor.token}` },
    },
  );
  expect(deleteResponse.status).toBe(200);
  const deleteBody = await deleteResponse.json();
  invariant(
    isDeleteOrganizationGroupResponse(deleteBody),
    "expected delete organization group response",
  );
  expect(deleteBody).toEqual({
    deleted: true,
    groupId,
    organizationId,
  });

  const postDeleteListResponse = await routeApp.request(
    `/organizations/${organizationId}/groups`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${actor.token}` },
    },
  );
  expect(postDeleteListResponse.status).toBe(200);
  const postDeleteListBody = await postDeleteListResponse.json();
  invariant(
    isListOrganizationGroupsResponse(postDeleteListBody),
    "expected list organization groups response",
  );
  expect(
    postDeleteListBody.groups.map((deletedGroup) => deletedGroup.groupId),
  ).not.toContain(groupId);
});
