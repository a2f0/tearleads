import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  groups as groupsTable,
  organizationRosterEntries,
  organizations,
} from "@tearleads/api-shared/schema";
import { createTestUser, type TestUser } from "@tearleads/bob-and-alice";
import {
  generateKemSeedAndKeyPair,
  wrapDekForRecipients,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import {
  isCommitOrganizationGroupPolicyResponse,
  isPrincipalPolicyBundleResponse,
} from "@tearleads/validators/response";
import { eq } from "drizzle-orm";
import invariant from "invariant";
import { authenticate } from "../../../test/helpers/authenticate";
import {
  addUserToAdminGroup,
  getCurrentOrganizationAdminAuthority,
} from "../../../test/helpers/organizationAdmin";
import {
  createPolicyTestGroup,
  createSignedPrincipalState,
  getDefaultOrganizationId,
  submitOrganizationGroupPolicyCommit,
} from "../../../test/helpers/principalPolicy";
import { createProjectionWithAdminSigner } from "../../../test/helpers/principalState";
import { registerUser } from "../../../test/helpers/registerUser";
import {
  getCurrentPrincipalState,
  listCurrentPrincipalProjectionMembers,
} from "../../access/read/principalStateStore";
import { routeApp } from "../../routeApp";

function toPolicyRequest(
  signedState: Awaited<ReturnType<typeof createSignedPrincipalState>>,
) {
  return {
    state: signedState.state,
    encryptedPayload: signedState.encryptedPayload,
    projection: signedState.projection,
    grants: signedState.grants,
    memberEnvelopes: signedState.memberEnvelopes,
  };
}

function putGroupPolicy(input: {
  actor: ReturnType<typeof createTestUser>;
  organizationId: string;
  principalId: string;
  signedState: Awaited<ReturnType<typeof createSignedPrincipalState>>;
}) {
  return submitOrganizationGroupPolicyCommit({
    actor: input.actor,
    groupId: input.principalId,
    groupPolicy: toPolicyRequest(input.signedState),
    organizationId: input.organizationId,
  });
}

async function readCommittedGroupPolicy(response: Response) {
  const body = await response.json();
  invariant(
    isCommitOrganizationGroupPolicyResponse(body),
    "expected compound principal policy response",
  );
  return body.groupPolicy;
}

async function addOrganizationMember(input: {
  actor: ReturnType<typeof createTestUser>;
  member: TestUser;
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
  invariant(currentState, "expected current Members state");
  const currentProjection = await listCurrentPrincipalProjectionMembers(
    "group",
    organization.memberGroupId,
    db,
  );
  const nextProjection = [
    ...currentProjection.map((projectionMember) => ({
      userId: projectionMember.userId,
      role: projectionMember.role,
    })),
    {
      userId: input.member.userId,
      role: "member" as const,
    },
  ];
  const signedState = await createSignedPrincipalState({
    principalType: "group",
    principalId: organization.memberGroupId,
    version: currentState.version + 1,
    prevStateHash: currentState.stateHash,
    keyEpoch: currentState.keyEpoch + 1,
    members: nextProjection.map((projectionMember) => ({
      userId: projectionMember.userId,
    })),
    projection: nextProjection,
    signerUserId: input.actor.userId,
    signerUserKeyFingerprint: input.actor.fingerprint,
    signingPrivateKey: input.actor.signing.signingPrivateKey,
  });

  const response = await putGroupPolicy({
    actor: input.actor,
    organizationId: input.organizationId,
    principalId: organization.memberGroupId,
    signedState,
  });
  expect(response.status).toBe(200);
}

test("PUT /principals/:principalType/:principalId/policy atomically stores and returns the current bundle", async () => {
  const actor = createTestUser();
  await registerUser(actor);
  await authenticate(actor);

  const principalId = crypto.randomUUID();
  await createPolicyTestGroup(actor.userId, principalId);
  const organizationId = await getDefaultOrganizationId(actor.userId);

  const signedState = await createSignedPrincipalState({
    principalType: "group",
    principalId,
    members: [{ userId: actor.userId }],
    signerUserId: actor.userId,
    signerUserKeyFingerprint: actor.fingerprint,
    signingPrivateKey: actor.signing.signingPrivateKey,
  });
  const projection = signedState.projection;
  const putPolicyResponse = await putGroupPolicy({
    actor,
    organizationId,
    principalId,
    signedState,
  });

  expect(putPolicyResponse.status).toBe(200);
  const storedPolicy = await readCommittedGroupPolicy(putPolicyResponse);
  const storedState = storedPolicy.currentState;
  expect(storedState.stateHash.length).toBeGreaterThan(0);
  expect(storedState.memberCount).toBe(1);

  const getPolicyResponse = await routeApp.request(
    `/principals/group/${principalId}/policy`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${actor.token}`,
      },
    },
  );

  expect(getPolicyResponse.status).toBe(200);
  const policyBundle = await getPolicyResponse.json();
  invariant(
    isPrincipalPolicyBundleResponse(policyBundle),
    "expected principal policy bundle response",
  );
  expect(policyBundle.currentState.stateHash).toBe(storedState.stateHash);
  expect(policyBundle.currentPayload.stateHash).toBe(storedState.stateHash);
  expect(policyBundle.currentProjection).toEqual(projection);
  expect(policyBundle.currentMemberEnvelopes.principalId).toBe(principalId);
  expect(policyBundle.currentMemberEnvelopes.stateHash).toBe(
    storedState.stateHash,
  );
  expect(policyBundle.currentMemberEnvelopes.epoch).toBe(1);
  expect(policyBundle.currentMemberEnvelopes.envelopes).toEqual(
    signedState.memberEnvelopes,
  );
  expect(policyBundle.previousStates).toEqual([]);
});

test("PUT /principals/:principalType/:principalId/policy syncs org roster from Members reachability", async () => {
  const actor = createTestUser();
  await registerUser(actor);
  await authenticate(actor);
  const member = createTestUser();
  await registerUser(member);

  const organizationId = await getDefaultOrganizationId(actor.userId);
  const [organization] = await db
    .select({ memberGroupId: organizations.memberGroupId })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  invariant(organization, "expected organization row");
  const currentState = await getCurrentPrincipalState(
    "group",
    organization.memberGroupId,
    db,
  );
  invariant(currentState, "expected current Members state");
  const currentProjection = await listCurrentPrincipalProjectionMembers(
    "group",
    organization.memberGroupId,
    db,
  );
  const nextProjection = [
    ...currentProjection.map((projectionMember) => ({
      userId: projectionMember.userId,
      role: projectionMember.role,
    })),
    {
      userId: member.userId,
      role: "member" as const,
    },
  ];
  const signedState = await createSignedPrincipalState({
    principalType: "group",
    principalId: organization.memberGroupId,
    version: currentState.version + 1,
    prevStateHash: currentState.stateHash,
    keyEpoch: currentState.keyEpoch + 1,
    members: nextProjection.map((projectionMember) => ({
      userId: projectionMember.userId,
    })),
    projection: nextProjection,
    signerUserId: actor.userId,
    signerUserKeyFingerprint: actor.fingerprint,
    signingPrivateKey: actor.signing.signingPrivateKey,
  });

  const response = await putGroupPolicy({
    actor,
    organizationId,
    principalId: organization.memberGroupId,
    signedState,
  });

  expect(response.status).toBe(200);
  const rosterEntries = await db
    .select({
      status: organizationRosterEntries.status,
      userId: organizationRosterEntries.userId,
    })
    .from(organizationRosterEntries)
    .where(eq(organizationRosterEntries.organizationId, organizationId));
  expect(rosterEntries).toContainEqual({
    status: "active",
    userId: member.userId,
  });
});

test("PUT /principals/:principalType/:principalId/policy rejects Admins users who are not organization members", async () => {
  const actor = createTestUser();
  await registerUser(actor);
  await authenticate(actor);
  const organizationId = await getDefaultOrganizationId(actor.userId);
  const outsider = createTestUser();
  await registerUser(outsider);

  const [organization] = await db
    .select({ adminGroupId: organizations.adminGroupId })
    .from(organizations)
    .where(eq(organizations.id, organizationId));
  invariant(organization, "expected organization row");
  const currentAdmins = await getCurrentPrincipalState(
    "group",
    organization.adminGroupId,
    db,
  );
  invariant(currentAdmins, "expected current Admins state");

  const projection = [
    { userId: actor.userId, role: "admin" as const },
    { userId: outsider.userId, role: "admin" as const },
  ];
  const signedState = await createSignedPrincipalState({
    principalType: "group",
    principalId: organization.adminGroupId,
    version: currentAdmins.version + 1,
    prevStateHash: currentAdmins.stateHash,
    keyEpoch: currentAdmins.keyEpoch + 1,
    members: projection.map((projectionMember) => ({
      userId: projectionMember.userId,
    })),
    projection,
    signerUserId: actor.userId,
    signerUserKeyFingerprint: actor.fingerprint,
    signingPrivateKey: actor.signing.signingPrivateKey,
  });

  const response = await putGroupPolicy({
    actor,
    organizationId,
    principalId: organization.adminGroupId,
    signedState,
  });

  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({
    error: "Admins contains users who are not active organization members",
  });
});

test("PUT /principals/:principalType/:principalId/policy rejects a Members removal that strands an admin", async () => {
  // Removing someone from Members takes them off the roster but leaves Admins
  // untouched, which would leave an admin nobody can see and nobody bills.
  // Admins has to be unwound first — the order the disable flow already uses.
  const actor = createTestUser();
  await registerUser(actor);
  await authenticate(actor);
  const organizationId = await getDefaultOrganizationId(actor.userId);
  const admin = createTestUser();
  await registerUser(admin);
  await addUserToAdminGroup({ actor, member: admin, organizationId });

  const [organization] = await db
    .select({ memberGroupId: organizations.memberGroupId })
    .from(organizations)
    .where(eq(organizations.id, organizationId));
  invariant(organization, "expected organization row");
  const currentMembers = await getCurrentPrincipalState(
    "group",
    organization.memberGroupId,
    db,
  );
  invariant(currentMembers, "expected current Members state");

  const projection = [{ userId: actor.userId, role: "admin" as const }];
  const signedState = await createSignedPrincipalState({
    principalType: "group",
    principalId: organization.memberGroupId,
    version: currentMembers.version + 1,
    prevStateHash: currentMembers.stateHash,
    keyEpoch: currentMembers.keyEpoch + 1,
    members: projection.map((projectionMember) => ({
      userId: projectionMember.userId,
    })),
    projection,
    signerUserId: actor.userId,
    signerUserKeyFingerprint: actor.fingerprint,
    signingPrivateKey: actor.signing.signingPrivateKey,
  });

  const response = await putGroupPolicy({
    actor,
    organizationId,
    principalId: organization.memberGroupId,
    signedState,
  });

  // The removal disables their roster entry in the same transaction, so Admins
  // is now holding a disabled user and that rule reports first. Either way the
  // write is refused rather than stranding an admin off the roster.
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({
    error: "Principal contains disabled organization users",
  });
  expect(
    (await getCurrentPrincipalState("group", organization.memberGroupId, db))
      ?.version,
  ).toBe(currentMembers.version);
});

test("PUT /principals/:principalType/:principalId/policy rejects disabled roster users in non-Members groups", async () => {
  const actor = createTestUser();
  await registerUser(actor);
  await authenticate(actor);
  const organizationId = await getDefaultOrganizationId(actor.userId);
  const disabledUser = createTestUser();
  await registerUser(disabledUser);
  await db.insert(organizationRosterEntries).values({
    organizationId,
    userId: disabledUser.userId,
    status: "disabled",
    disabledAt: new Date("2026-05-24T12:00:00.000Z"),
    disabledByUserId: actor.userId,
  });

  const groupId = crypto.randomUUID();
  await db.insert(groupsTable).values({
    id: groupId,
    organizationId,
    name: "Operators",
  });
  const projection = [
    {
      userId: actor.userId,
      role: "admin" as const,
    },
    {
      userId: disabledUser.userId,
      role: "member" as const,
    },
  ];
  const signedState = await createSignedPrincipalState({
    principalType: "group",
    principalId: groupId,
    members: projection.map((projectionMember) => ({
      userId: projectionMember.userId,
    })),
    projection,
    signerUserId: actor.userId,
    signerUserKeyFingerprint: actor.fingerprint,
    signingPrivateKey: actor.signing.signingPrivateKey,
  });

  const response = await putGroupPolicy({
    actor,
    organizationId,
    principalId: groupId,
    signedState,
  });

  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({
    error: "Principal contains disabled organization users",
  });
  expect(await getCurrentPrincipalState("group", groupId, db)).toBeNull();
});

test("GET /principals/:principalType/:principalId/policy returns previous states for successor verification", async () => {
  const actor = createTestUser();
  await registerUser(actor);
  await authenticate(actor);

  const principalId = crypto.randomUUID();
  await createPolicyTestGroup(actor.userId, principalId);
  const organizationId = await getDefaultOrganizationId(actor.userId);
  const members = [{ userId: actor.userId }];
  const principalKem = generateKemSeedAndKeyPair();
  const projection = createProjectionWithAdminSigner(actor.userId, members);

  const initialSignedState = await createSignedPrincipalState({
    principalType: "group",
    principalId,
    principalKem,
    members,
    projection,
    signerUserId: actor.userId,
    signerUserKeyFingerprint: actor.fingerprint,
    signingPrivateKey: actor.signing.signingPrivateKey,
  });

  const initialPutResponse = await putGroupPolicy({
    actor,
    organizationId,
    principalId,
    signedState: initialSignedState,
  });

  expect(initialPutResponse.status).toBe(200);
  const initialStoredPolicy =
    await readCommittedGroupPolicy(initialPutResponse);
  const initialStoredState = initialStoredPolicy.currentState;

  const successorSignedState = await createSignedPrincipalState({
    principalType: "group",
    principalId,
    principalKem,
    version: 2,
    prevStateHash: initialStoredState.stateHash,
    members,
    projection,
    signedAt: "2026-04-08T16:01:00.000Z",
    signerUserId: actor.userId,
    signerUserKeyFingerprint: actor.fingerprint,
    signingPrivateKey: actor.signing.signingPrivateKey,
  });

  const successorPutResponse = await putGroupPolicy({
    actor,
    organizationId,
    principalId,
    signedState: successorSignedState,
  });

  expect(successorPutResponse.status).toBe(200);
  const successorStoredPolicy =
    await readCommittedGroupPolicy(successorPutResponse);
  const successorStoredState = successorStoredPolicy.currentState;

  const getPolicyResponse = await routeApp.request(
    `/principals/group/${principalId}/policy`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${actor.token}`,
      },
    },
  );

  expect(getPolicyResponse.status).toBe(200);
  const policyBundle = await getPolicyResponse.json();
  invariant(
    isPrincipalPolicyBundleResponse(policyBundle),
    "expected principal policy bundle response",
  );
  expect(policyBundle.currentState.stateHash).toBe(
    successorStoredState.stateHash,
  );
  expect(policyBundle.previousStates).toHaveLength(1);
  expect(policyBundle.previousStates[0]?.state.stateHash).toBe(
    initialStoredState.stateHash,
  );
  expect(policyBundle.previousStates[0]?.projection).toEqual(projection);
});

test("PUT /principals/:principalType/:principalId/policy stores signed current member wraps", async () => {
  const actor = createTestUser();
  await registerUser(actor);
  await authenticate(actor);

  const principalId = crypto.randomUUID();
  await createPolicyTestGroup(actor.userId, principalId);
  const organizationId = await getDefaultOrganizationId(actor.userId);

  const signedState = await createSignedPrincipalState({
    principalType: "group",
    principalId,
    members: [{ userId: actor.userId }],
    signerUserId: actor.userId,
    signerUserKeyFingerprint: actor.fingerprint,
    signingPrivateKey: actor.signing.signingPrivateKey,
  });

  const putPolicyResponse = await putGroupPolicy({
    actor,
    organizationId,
    principalId,
    signedState,
  });

  expect(putPolicyResponse.status).toBe(200);
  const storedPolicy = await readCommittedGroupPolicy(putPolicyResponse);
  const storedState = storedPolicy.currentState;
  const storedMemberEnvelopes = storedPolicy.currentMemberEnvelopes;
  expect(storedMemberEnvelopes.stateHash).toBe(storedState.stateHash);
  expect(storedMemberEnvelopes.envelopes).toEqual(signedState.memberEnvelopes);

  const getPolicyResponse = await routeApp.request(
    `/principals/group/${principalId}/policy`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${actor.token}`,
      },
    },
  );

  expect(getPolicyResponse.status).toBe(200);
  const policyBundle = await getPolicyResponse.json();
  invariant(
    isPrincipalPolicyBundleResponse(policyBundle),
    "expected principal policy bundle response",
  );
  expect(policyBundle.currentMemberEnvelopes.envelopes).toEqual(
    storedMemberEnvelopes.envelopes,
  );
});

// The combined write binds the exact envelope set into the signed state and
// requires the authenticated requester to be that signer. An unrelated user
// therefore cannot replace stored wraps by replaying the public policy with
// different, otherwise well-formed ciphertext.
test("PUT /principals/:principalType/:principalId/policy rejects a non-signer and preserves existing envelopes", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);

  // An unrelated authenticated user: registered, with a valid session, but not
  // a member of the target principal.
  const outsider = createTestUser();
  await registerUser(outsider);
  await authenticate(outsider);

  const principalId = crypto.randomUUID();
  await createPolicyTestGroup(owner.userId, principalId);
  const organizationId = await getDefaultOrganizationId(owner.userId);
  const principalKem = generateKemSeedAndKeyPair();
  const signedState = await createSignedPrincipalState({
    principalType: "group",
    principalId,
    principalKem,
    members: [{ userId: owner.userId }],
    signerUserId: owner.userId,
    signerUserKeyFingerprint: owner.fingerprint,
    signingPrivateKey: owner.signing.signingPrivateKey,
  });
  const seedResponse = await putGroupPolicy({
    actor: owner,
    organizationId,
    principalId,
    signedState,
  });
  expect(seedResponse.status).toBe(200);
  await readCommittedGroupPolicy(seedResponse);
  const legitimateEnvelope = signedState.memberEnvelopes[0];
  invariant(legitimateEnvelope, "expected legitimate member envelope");

  // The outsider learns the public policy and submits alternate, real wrapped
  // material while replaying the owner's signed state.
  const outsiderPolicyResponse = await routeApp.request(
    `/principals/group/${principalId}/policy`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${outsider.token}` },
    },
  );
  expect(outsiderPolicyResponse.status).toBe(200);

  const [alternateWrappedKey] = await wrapDekForRecipients(
    principalKem.secretKey,
    [owner.kem.publicKey],
  );
  invariant(alternateWrappedKey, "expected alternate member envelope");
  const alternateEnvelope = {
    ...legitimateEnvelope,
    kemCipherText: bytesToBase64(alternateWrappedKey.kemCipherText),
    wrappedKey: bytesToBase64(alternateWrappedKey.wrappedKey),
  };

  const attackResponse = await submitOrganizationGroupPolicyCommit({
    actor: outsider,
    groupId: principalId,
    groupPolicy: {
      ...toPolicyRequest(signedState),
      memberEnvelopes: [alternateEnvelope],
    },
    organizationId,
  });

  expect(attackResponse.status).toBe(403);
  expect(await attackResponse.json()).toEqual({
    error: "Principal policy signer does not match authenticated requester",
  });

  // The legitimate envelopes must survive untouched.
  const ownerPolicyResponse = await routeApp.request(
    `/principals/group/${principalId}/policy`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${owner.token}` },
    },
  );
  expect(ownerPolicyResponse.status).toBe(200);
  const policyBundle = await ownerPolicyResponse.json();
  invariant(
    isPrincipalPolicyBundleResponse(policyBundle),
    "expected principal policy bundle response",
  );
  expect(policyBundle.currentMemberEnvelopes.envelopes).toEqual(
    signedState.memberEnvelopes,
  );
});

test("PUT /principals/:principalType/:principalId/policy rejects signers who are not admins", async () => {
  const actor = createTestUser();
  await registerUser(actor);
  await authenticate(actor);

  const principalId = crypto.randomUUID();
  await createPolicyTestGroup(actor.userId, principalId);
  const organizationId = await getDefaultOrganizationId(actor.userId);
  const signedState = await createSignedPrincipalState({
    principalType: "group",
    principalId,
    members: [{ userId: actor.userId }],
    signerUserId: actor.userId,
    signerUserKeyFingerprint: actor.fingerprint,
    signingPrivateKey: actor.signing.signingPrivateKey,
    projection: [
      {
        userId: actor.userId,
        role: "member",
      },
    ],
  });

  const response = await putGroupPolicy({
    actor,
    organizationId,
    principalId,
    signedState,
  });

  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({
    error: "Principal state signer must be an admin",
  });
});

test("PUT /principals/:principalType/:principalId/policy allows org admins to update org-scoped group policy", async () => {
  const orgAdmin = createTestUser();
  await registerUser(orgAdmin);
  await authenticate(orgAdmin);
  const organizationId = await getDefaultOrganizationId(orgAdmin.userId);

  const groupAdmin = createTestUser();
  await registerUser(groupAdmin);
  await authenticate(groupAdmin);
  await addOrganizationMember({
    actor: orgAdmin,
    member: groupAdmin,
    organizationId,
  });

  const groupId = crypto.randomUUID();
  await db.insert(groupsTable).values({
    id: groupId,
    organizationId,
    name: "Operators",
  });
  const externalAuthority =
    await getCurrentOrganizationAdminAuthority(organizationId);

  const principalKem = generateKemSeedAndKeyPair();
  const initialState = await createSignedPrincipalState({
    principalType: "group",
    principalId: groupId,
    principalKem,
    members: [],
    projection: [],
    externalAuthority,
    signerUserId: orgAdmin.userId,
    signerUserKeyFingerprint: orgAdmin.fingerprint,
    signingPrivateKey: orgAdmin.signing.signingPrivateKey,
  });
  const initialResponse = await putGroupPolicy({
    actor: orgAdmin,
    organizationId,
    principalId: groupId,
    signedState: initialState,
  });
  expect(initialResponse.status).toBe(200);
  const initialStoredPolicy = await readCommittedGroupPolicy(initialResponse);
  const initialStoredState = initialStoredPolicy.currentState;
  const successorProjection = [
    {
      userId: groupAdmin.userId,
      role: "admin" as const,
    },
    {
      userId: orgAdmin.userId,
      role: "member" as const,
    },
  ];
  const successorState = await createSignedPrincipalState({
    principalType: "group",
    principalId: groupId,
    version: 2,
    prevStateHash: initialStoredState.stateHash,
    keyEpoch: initialStoredState.keyEpoch,
    principalKem,
    members: successorProjection.map((member) => ({ userId: member.userId })),
    projection: successorProjection,
    externalAuthority,
    signedAt: "2026-04-08T16:01:00.000Z",
    signerUserId: orgAdmin.userId,
    signerUserKeyFingerprint: orgAdmin.fingerprint,
    signingPrivateKey: orgAdmin.signing.signingPrivateKey,
  });

  const successorResponse = await putGroupPolicy({
    actor: orgAdmin,
    organizationId,
    principalId: groupId,
    signedState: successorState,
  });

  expect(successorResponse.status).toBe(200);
  const successorStoredPolicy =
    await readCommittedGroupPolicy(successorResponse);
  const successorStoredState = successorStoredPolicy.currentState;
  expect(successorStoredState.signerUserId).toBe(orgAdmin.userId);
  expect(successorStoredState.version).toBe(2);
}, 10_000);
