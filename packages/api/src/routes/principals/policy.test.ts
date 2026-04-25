import { expect, test } from "bun:test";
import { createTestUser } from "@tearleads/bob-and-alice";
import { generateKemSeedAndKeyPair, toFingerprint } from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import {
  isCurrentPrincipalMemberEnvelopesResponse,
  isPrincipalPolicyBundleResponse,
  isPrincipalStateResponse,
} from "@tearleads/validators/response";
import invariant from "invariant";
import { authenticate } from "../../../test/helpers/authenticate";
import {
  createProjectionWithAdminSigner,
  signPrincipalStateBundle,
} from "../../../test/helpers/principalState";
import { registerUser } from "../../../test/helpers/registerUser";
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
