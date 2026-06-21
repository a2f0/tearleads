import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  groups as groupsTable,
  organizationRosterEntries,
  organizations,
  users,
} from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/bob-and-alice";
import { generateKemSeedAndKeyPair, toFingerprint } from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import {
  isCurrentPrincipalMemberEnvelopesResponse,
  isPrincipalPolicyBundleResponse,
  isPrincipalStateResponse,
} from "@tearleads/validators/response";
import { eq } from "drizzle-orm";
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
import { routeApp } from "../../routeApp";

async function createSignedPrincipalState(input: {
  keyEpoch?: number;
  members: Array<{ principalType: "user" | "group"; principalId: string }>;
  prevStateHash?: string | null;
  principalKem?: ReturnType<typeof generateKemSeedAndKeyPair>;
  principalId: string;
  principalType: "group" | "organization";
  signedAt?: string;
  signerUserId: string;
  signerUserKeyFingerprint: string;
  signingPrivateKey: Uint8Array;
  version?: number;
  projection?: Array<{
    memberPrincipalType: "user" | "group";
    memberPrincipalId: string;
    role: "member" | "admin";
  }>;
}) {
  const principalKem = input.principalKem ?? generateKemSeedAndKeyPair();
  const projection =
    input.projection ??
    createProjectionWithAdminSigner(input.signerUserId, input.members);

  return signPrincipalStateBundle({
    principalType: input.principalType,
    principalId: input.principalId,
    version: input.version ?? 1,
    prevStateHash: input.prevStateHash ?? null,
    keyEpoch: input.keyEpoch ?? 1,
    encapsulationPublicKey: bytesToBase64(principalKem.publicKey),
    keyFingerprint: await toFingerprint(principalKem.publicKey),
    members: input.members,
    projection,
    payloadCiphertext: bytesToBase64(
      new TextEncoder().encode(JSON.stringify(input.members)),
    ),
    signedAt:
      input.signedAt ?? new Date("2026-04-08T16:00:00.000Z").toISOString(),
    signerUserId: input.signerUserId,
    signerUserKeyFingerprint: input.signerUserKeyFingerprint,
    signingPrivateKey: input.signingPrivateKey,
  });
}

async function getDefaultOrganizationId(userId: string): Promise<string> {
  const [user] = await db
    .select({ organizationId: users.defaultOrganizationId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  invariant(user, "expected registered user");
  return user.organizationId;
}

async function addOrganizationMember(input: {
  actor: ReturnType<typeof createTestUser>;
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
  invariant(currentState, "expected current Members state");
  const currentProjection = await listCurrentPrincipalProjectionMembers(
    "group",
    organization.memberGroupId,
    db,
  );
  const nextProjection = [
    ...currentProjection.map((projectionMember) => ({
      memberPrincipalType: projectionMember.memberPrincipalType,
      memberPrincipalId: projectionMember.memberPrincipalId,
      role: projectionMember.role,
    })),
    {
      memberPrincipalType: "user" as const,
      memberPrincipalId: input.memberUserId,
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
      principalType: projectionMember.memberPrincipalType,
      principalId: projectionMember.memberPrincipalId,
    })),
    projection: nextProjection,
    signerUserId: input.actor.userId,
    signerUserKeyFingerprint: input.actor.fingerprint,
    signingPrivateKey: input.actor.signing.signingPrivateKey,
  });

  const response = await routeApp.request(
    `/principals/group/${organization.memberGroupId}/state`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${input.actor.token}`,
      },
      body: JSON.stringify({
        state: signedState.state,
        encryptedPayload: signedState.encryptedPayload,
        projection: signedState.projection,
      }),
    },
  );
  expect(response.status).toBe(200);
}

test("PUT /principals/:principalType/:principalId/state stores verified state and GET /policy returns the current bundle", async () => {
  const actor = createTestUser();
  await registerUser(actor);
  await authenticate(actor);

  const principalId = crypto.randomUUID();

  const signedState = await createSignedPrincipalState({
    principalType: "group",
    principalId,
    members: [{ principalType: "user", principalId: actor.userId }],
    signerUserId: actor.userId,
    signerUserKeyFingerprint: actor.fingerprint,
    signingPrivateKey: actor.signing.signingPrivateKey,
  });
  const projection = signedState.projection;

  const putStateResponse = await routeApp.request(
    `/principals/group/${principalId}/state`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${actor.token}`,
      },
      body: JSON.stringify({
        state: signedState.state,
        encryptedPayload: signedState.encryptedPayload,
        projection,
      }),
    },
  );

  expect(putStateResponse.status).toBe(200);
  const storedState = await putStateResponse.json();
  invariant(
    isPrincipalStateResponse(storedState),
    "expected principal state response",
  );
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
  expect(policyBundle.currentMemberEnvelopes.envelopes).toEqual([]);
  expect(policyBundle.previousStates).toEqual([]);
});

test("PUT /principals/:principalType/:principalId/state syncs org roster from Members reachability", async () => {
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
      memberPrincipalType: projectionMember.memberPrincipalType,
      memberPrincipalId: projectionMember.memberPrincipalId,
      role: projectionMember.role,
    })),
    {
      memberPrincipalType: "user" as const,
      memberPrincipalId: member.userId,
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
      principalType: projectionMember.memberPrincipalType,
      principalId: projectionMember.memberPrincipalId,
    })),
    projection: nextProjection,
    signerUserId: actor.userId,
    signerUserKeyFingerprint: actor.fingerprint,
    signingPrivateKey: actor.signing.signingPrivateKey,
  });

  const response = await routeApp.request(
    `/principals/group/${organization.memberGroupId}/state`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${actor.token}`,
      },
      body: JSON.stringify({
        state: signedState.state,
        encryptedPayload: signedState.encryptedPayload,
        projection: signedState.projection,
      }),
    },
  );

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

test("PUT /principals/:principalType/:principalId/state rejects disabled roster users in non-Members groups", async () => {
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
      memberPrincipalType: "user" as const,
      memberPrincipalId: actor.userId,
      role: "admin" as const,
    },
    {
      memberPrincipalType: "user" as const,
      memberPrincipalId: disabledUser.userId,
      role: "member" as const,
    },
  ];
  const signedState = await createSignedPrincipalState({
    principalType: "group",
    principalId: groupId,
    members: projection.map((projectionMember) => ({
      principalType: projectionMember.memberPrincipalType,
      principalId: projectionMember.memberPrincipalId,
    })),
    projection,
    signerUserId: actor.userId,
    signerUserKeyFingerprint: actor.fingerprint,
    signingPrivateKey: actor.signing.signingPrivateKey,
  });

  const response = await routeApp.request(
    `/principals/group/${groupId}/state`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${actor.token}`,
      },
      body: JSON.stringify({
        state: signedState.state,
        encryptedPayload: signedState.encryptedPayload,
        projection: signedState.projection,
      }),
    },
  );

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
  const members = [
    { principalType: "user" as const, principalId: actor.userId },
  ];
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

  const initialPutResponse = await routeApp.request(
    `/principals/group/${principalId}/state`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${actor.token}`,
      },
      body: JSON.stringify({
        state: initialSignedState.state,
        encryptedPayload: initialSignedState.encryptedPayload,
        projection,
      }),
    },
  );

  expect(initialPutResponse.status).toBe(200);
  const initialStoredState = await initialPutResponse.json();
  invariant(
    isPrincipalStateResponse(initialStoredState),
    "expected initial principal state response",
  );

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

  const successorPutResponse = await routeApp.request(
    `/principals/group/${principalId}/state`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${actor.token}`,
      },
      body: JSON.stringify({
        state: successorSignedState.state,
        encryptedPayload: successorSignedState.encryptedPayload,
        projection,
      }),
    },
  );

  expect(successorPutResponse.status).toBe(200);
  const successorStoredState = await successorPutResponse.json();
  invariant(
    isPrincipalStateResponse(successorStoredState),
    "expected successor principal state response",
  );

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

test("PUT /principals/:principalType/:principalId/member-envelopes stores current member wraps", async () => {
  const actor = createTestUser();
  await registerUser(actor);
  await authenticate(actor);

  const principalId = crypto.randomUUID();

  const signedState = await createSignedPrincipalState({
    principalType: "group",
    principalId,
    members: [{ principalType: "user", principalId: actor.userId }],
    signerUserId: actor.userId,
    signerUserKeyFingerprint: actor.fingerprint,
    signingPrivateKey: actor.signing.signingPrivateKey,
  });
  const projection = signedState.projection;

  const putStateResponse = await routeApp.request(
    `/principals/group/${principalId}/state`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${actor.token}`,
      },
      body: JSON.stringify({
        state: signedState.state,
        encryptedPayload: signedState.encryptedPayload,
        projection,
      }),
    },
  );

  expect(putStateResponse.status).toBe(200);
  const storedState = await putStateResponse.json();
  invariant(
    isPrincipalStateResponse(storedState),
    "expected principal state response",
  );

  const putMemberEnvelopesResponse = await routeApp.request(
    `/principals/group/${principalId}/member-envelopes`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${actor.token}`,
      },
      body: JSON.stringify({
        stateHash: storedState.stateHash,
        envelopes: [
          {
            memberPrincipalType: "user",
            memberPrincipalId: actor.userId,
            memberKeyFingerprint: await toFingerprint(actor.kem.publicKey),
            kemCipherText: "member-kem-ciphertext",
            wrappedKey: "member-wrapped-key",
          },
        ],
      }),
    },
  );

  expect(putMemberEnvelopesResponse.status).toBe(200);
  const storedMemberEnvelopes = await putMemberEnvelopesResponse.json();
  invariant(
    isCurrentPrincipalMemberEnvelopesResponse(storedMemberEnvelopes),
    "expected principal member envelopes response",
  );
  expect(storedMemberEnvelopes.stateHash).toBe(storedState.stateHash);
  expect(storedMemberEnvelopes.envelopes).toEqual([
    {
      memberPrincipalType: "user",
      memberPrincipalId: actor.userId,
      memberKeyFingerprint: await toFingerprint(actor.kem.publicKey),
      kemCipherText: "member-kem-ciphertext",
      wrappedKey: "member-wrapped-key",
    },
  ]);

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

// Regression for a missing-authorization defect: the member-envelopes write
// unconditionally DELETEs every existing envelope and INSERTs the supplied
// rows, the envelopes are unsigned, and the wrapped key material is opaque to
// the server. Before this fix the route was gated only by `requireAuth`, so any
// authenticated user (with no relationship to the principal) could read the
// public policy bundle (stateHash + member set + per-member fingerprints) via
// GET /policy and replay a structurally-valid PUT with attacker-chosen wrapped
// keys, irrecoverably destroying the legitimate envelopes and locking every
// member out of decrypting anything shared to that principal. Membership is the
// only authorization signal available (no signer to verify), so a non-member
// must be rejected and the stored envelopes must be left intact.
test("PUT /principals/:principalType/:principalId/member-envelopes rejects a non-member and preserves existing envelopes", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);

  // An unrelated authenticated user: registered, with a valid session, but not
  // a member of the target principal.
  const outsider = createTestUser();
  await registerUser(outsider);
  await authenticate(outsider);

  const principalId = crypto.randomUUID();
  const signedState = await createSignedPrincipalState({
    principalType: "group",
    principalId,
    members: [{ principalType: "user", principalId: owner.userId }],
    signerUserId: owner.userId,
    signerUserKeyFingerprint: owner.fingerprint,
    signingPrivateKey: owner.signing.signingPrivateKey,
  });
  const putStateResponse = await routeApp.request(
    `/principals/group/${principalId}/state`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${owner.token}`,
      },
      body: JSON.stringify({
        state: signedState.state,
        encryptedPayload: signedState.encryptedPayload,
        projection: signedState.projection,
      }),
    },
  );
  expect(putStateResponse.status).toBe(200);
  const storedState = await putStateResponse.json();
  invariant(
    isPrincipalStateResponse(storedState),
    "expected principal state response",
  );

  // The legitimate member seeds the real envelopes.
  const legitimateEnvelope = {
    memberPrincipalType: "user" as const,
    memberPrincipalId: owner.userId,
    memberKeyFingerprint: await toFingerprint(owner.kem.publicKey),
    kemCipherText: "owner-kem-ciphertext",
    wrappedKey: "owner-wrapped-key",
  };
  const seedResponse = await routeApp.request(
    `/principals/group/${principalId}/member-envelopes`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${owner.token}`,
      },
      body: JSON.stringify({
        stateHash: storedState.stateHash,
        envelopes: [legitimateEnvelope],
      }),
    },
  );
  expect(seedResponse.status).toBe(200);

  // The attack: the outsider learns everything it needs from the public policy
  // bundle, then replays a structurally-valid PUT with garbage wrapped keys.
  const outsiderPolicyResponse = await routeApp.request(
    `/principals/group/${principalId}/policy`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${outsider.token}` },
    },
  );
  expect(outsiderPolicyResponse.status).toBe(200);

  const attackResponse = await routeApp.request(
    `/principals/group/${principalId}/member-envelopes`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${outsider.token}`,
      },
      body: JSON.stringify({
        stateHash: storedState.stateHash,
        envelopes: [
          {
            ...legitimateEnvelope,
            // Correct (public) fingerprint, attacker-controlled key material.
            kemCipherText: "attacker-kem-ciphertext",
            wrappedKey: "attacker-wrapped-key",
          },
        ],
      }),
    },
  );

  expect(attackResponse.status).toBe(403);
  expect(await attackResponse.json()).toEqual({
    error:
      "Principal member envelope writer is not authorized for this principal",
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
  expect(policyBundle.currentMemberEnvelopes.envelopes).toEqual([
    legitimateEnvelope,
  ]);
});

test("PUT /principals/:principalType/:principalId/state rejects signers who are not admins", async () => {
  const actor = createTestUser();
  await registerUser(actor);
  await authenticate(actor);

  const principalId = crypto.randomUUID();
  const signedState = await createSignedPrincipalState({
    principalType: "organization",
    principalId,
    members: [{ principalType: "user", principalId: actor.userId }],
    signerUserId: actor.userId,
    signerUserKeyFingerprint: actor.fingerprint,
    signingPrivateKey: actor.signing.signingPrivateKey,
    projection: [
      {
        memberPrincipalType: "user",
        memberPrincipalId: actor.userId,
        role: "member",
      },
    ],
  });

  const response = await routeApp.request(
    `/principals/organization/${principalId}/state`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${actor.token}`,
      },
      body: JSON.stringify({
        state: signedState.state,
        encryptedPayload: signedState.encryptedPayload,
        projection: [
          {
            memberPrincipalType: "user",
            memberPrincipalId: actor.userId,
            role: "member",
          },
        ],
      }),
    },
  );

  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({
    error: "Principal state signer must be an admin",
  });
});

test("PUT /principals/:principalType/:principalId/state allows org admins to update org-scoped group policy", async () => {
  const orgAdmin = createTestUser();
  await registerUser(orgAdmin);
  await authenticate(orgAdmin);
  const organizationId = await getDefaultOrganizationId(orgAdmin.userId);

  const groupAdmin = createTestUser();
  await registerUser(groupAdmin);
  await addOrganizationMember({
    actor: orgAdmin,
    memberUserId: groupAdmin.userId,
    organizationId,
  });

  const groupId = crypto.randomUUID();
  await db.insert(groupsTable).values({
    id: groupId,
    organizationId,
    name: "Operators",
  });

  const principalKem = generateKemSeedAndKeyPair();
  const initialState = await createSignedPrincipalState({
    principalType: "group",
    principalId: groupId,
    principalKem,
    members: [{ principalType: "user", principalId: groupAdmin.userId }],
    signerUserId: groupAdmin.userId,
    signerUserKeyFingerprint: groupAdmin.fingerprint,
    signingPrivateKey: groupAdmin.signing.signingPrivateKey,
  });
  const initialResponse = await routeApp.request(
    `/principals/group/${groupId}/state`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${orgAdmin.token}`,
      },
      body: JSON.stringify({
        state: initialState.state,
        encryptedPayload: initialState.encryptedPayload,
        projection: initialState.projection,
      }),
    },
  );
  expect(initialResponse.status).toBe(200);
  const initialStoredState = await initialResponse.json();
  invariant(
    isPrincipalStateResponse(initialStoredState),
    "expected initial principal state response",
  );

  const successorProjection = [
    ...initialState.projection,
    {
      memberPrincipalType: "user" as const,
      memberPrincipalId: orgAdmin.userId,
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
    members: successorProjection.map((member) => ({
      principalType: member.memberPrincipalType,
      principalId: member.memberPrincipalId,
    })),
    projection: successorProjection,
    signedAt: "2026-04-08T16:01:00.000Z",
    signerUserId: orgAdmin.userId,
    signerUserKeyFingerprint: orgAdmin.fingerprint,
    signingPrivateKey: orgAdmin.signing.signingPrivateKey,
  });

  const successorResponse = await routeApp.request(
    `/principals/group/${groupId}/state`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${orgAdmin.token}`,
      },
      body: JSON.stringify({
        state: successorState.state,
        encryptedPayload: successorState.encryptedPayload,
        projection: successorProjection,
      }),
    },
  );

  expect(successorResponse.status).toBe(200);
  const successorStoredState = await successorResponse.json();
  invariant(
    isPrincipalStateResponse(successorStoredState),
    "expected successor principal state response",
  );
  expect(successorStoredState.signerUserId).toBe(orgAdmin.userId);
  expect(successorStoredState.version).toBe(2);
}, 10_000);
