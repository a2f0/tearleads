import { expect, test } from "bun:test";
import { createTestUser } from "@tearleads/bob-and-alice";
import {
  computePrincipalStatePayloadCiphertextHash,
  generateKemSeedAndKeyPair,
  signPrincipalState,
  toFingerprint,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import {
  isCurrentPrincipalMemberEnvelopesResponse,
  isPrincipalPolicyBundleResponse,
  isPrincipalStateResponse,
} from "@tearleads/validators/response";
import invariant from "invariant";
import { authenticate } from "../../../test/helpers/authenticate";
import { createProjectionWithAdminSigner } from "../../../test/helpers/principalState";
import { registerUser } from "../../../test/helpers/registerUser";
import { routeApp } from "../../routeApp";

async function createSignedPrincipalState(input: {
  keyEpoch?: number;
  members: Array<{ principalType: "user" | "group"; principalId: string }>;
  principalId: string;
  principalType: "group" | "organization";
  signerUserId: string;
  signerUserKeyFingerprint: string;
  signingPrivateKey: Uint8Array;
  projection?: Array<{
    memberPrincipalType: "user" | "group";
    memberPrincipalId: string;
    role: "member" | "admin";
  }>;
}) {
  const principalKem = generateKemSeedAndKeyPair();

  return signPrincipalState(
    {
      principalType: input.principalType,
      principalId: input.principalId,
      version: 1,
      prevStateHash: null,
      keyEpoch: input.keyEpoch ?? 1,
      encapsulationPublicKey: bytesToBase64(principalKem.publicKey),
      keyFingerprint: await toFingerprint(principalKem.publicKey),
      members: input.members,
      projection:
        input.projection ??
        createProjectionWithAdminSigner(input.signerUserId, input.members),
      payloadCiphertext: bytesToBase64(
        new TextEncoder().encode(JSON.stringify(input.members)),
      ),
      signedAt: new Date("2026-04-08T16:00:00.000Z").toISOString(),
      signerUserId: input.signerUserId,
      signerUserKeyFingerprint: input.signerUserKeyFingerprint,
    },
    input.signingPrivateKey,
  );
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
  const projection = createProjectionWithAdminSigner(
    actor.userId,
    signedState.members ?? [],
  );

  const putStateResponse = await routeApp.request(
    `/principals/group/${principalId}/state`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${actor.token}`,
      },
      body: JSON.stringify({
        state: signedState,
        encryptedPayload: {
          cipherSuite: "aes-256-gcm-v1",
          ciphertext: signedState.payloadCiphertext,
          ciphertextHash: await computePrincipalStatePayloadCiphertextHash(
            signedState.payloadCiphertext ?? "",
          ),
        },
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
  const projection = createProjectionWithAdminSigner(
    actor.userId,
    signedState.members ?? [],
  );

  const putStateResponse = await routeApp.request(
    `/principals/group/${principalId}/state`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${actor.token}`,
      },
      body: JSON.stringify({
        state: signedState,
        encryptedPayload: {
          cipherSuite: "aes-256-gcm-v1",
          ciphertext: signedState.payloadCiphertext,
          ciphertextHash: await computePrincipalStatePayloadCiphertextHash(
            signedState.payloadCiphertext ?? "",
          ),
        },
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
        state: signedState,
        encryptedPayload: {
          cipherSuite: "aes-256-gcm-v1",
          ciphertext: signedState.payloadCiphertext,
          ciphertextHash: await computePrincipalStatePayloadCiphertextHash(
            signedState.payloadCiphertext ?? "",
          ),
        },
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
