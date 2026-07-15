import { expect, test } from "bun:test";
import { createTestUser } from "@tearleads/bob-and-alice";
import {
  generateKemSeedAndKeyPair,
  toFingerprint,
  wrapDekForRecipients,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import { isPrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import invariant from "invariant";
import { authenticate } from "../../../test/helpers/authenticate";
import {
  createProjectionWithAdminSigner,
  signPrincipalStateBundle,
} from "../../../test/helpers/principalState";
import { registerUser } from "../../../test/helpers/registerUser";
import { createRouteApp } from "../../routeApp";

// Sign a complete minimal group policy whose only member is the signing user,
// including the exact member envelope committed by the state signature.
async function signSoloGroupState(
  actor: ReturnType<typeof createTestUser>,
  principalId: string,
) {
  const projection = createProjectionWithAdminSigner(actor.userId, [
    { principalType: "user", principalId: actor.userId },
  ]);
  const groupKem = generateKemSeedAndKeyPair();
  const [wrappedGroupKey] = await wrapDekForRecipients(groupKem.secretKey, [
    actor.kem.publicKey,
  ]);
  invariant(wrappedGroupKey, "expected principal member envelope");
  const memberEnvelopes = [
    {
      memberPrincipalType: "user" as const,
      memberPrincipalId: actor.userId,
      memberKeyFingerprint: await toFingerprint(actor.kem.publicKey),
      kemCipherText: bytesToBase64(wrappedGroupKey.kemCipherText),
      wrappedKey: bytesToBase64(wrappedGroupKey.wrappedKey),
    },
  ];
  return signPrincipalStateBundle({
    principalType: "group",
    principalId,
    version: 1,
    prevStateHash: null,
    keyEpoch: 1,
    encapsulationPublicKey: bytesToBase64(groupKem.publicKey),
    keyFingerprint: await toFingerprint(groupKem.publicKey),
    members: [{ principalType: "user", principalId: actor.userId }],
    projection,
    payloadCiphertext: JSON.stringify({ members: projection }),
    signedAt: "2026-04-08T16:00:00.000Z",
    signerUserId: actor.userId,
    signerUserKeyFingerprint: actor.fingerprint,
    signingPrivateKey: actor.signing.signingPrivateKey,
    memberEnvelopes,
  });
}

function sharedWithYouUserIds(
  events: ReadonlyArray<Record<string, unknown>>,
): string[] {
  return events
    .filter((event) => Reflect.get(event, "type") === "shared_with_you")
    .map((event) => Reflect.get(event, "userId"))
    .filter((userId): userId is string => typeof userId === "string");
}

// Second pass on PR #1184 (which auto-surfaced direct "Share With Peer" shares):
// Committing the complete policy grants each member access to the group key.
// Publish only after that atomic commit so a recipient's immediate re-list can
// never observe the signed state without its corresponding wrap.
test("PUT policy publishes a user-scoped shared_with_you after the atomic commit", async () => {
  const actor = createTestUser();
  await registerUser(actor);
  await authenticate(actor);

  const publishedEvents: Array<Record<string, unknown>> = [];
  const app = createRouteApp({
    publish: async (event) => {
      publishedEvents.push(event);
    },
  });

  const principalId = crypto.randomUUID();
  const signedState = await signSoloGroupState(actor, principalId);

  const putPolicyResponse = await app.request(
    `/principals/group/${principalId}/policy`,
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
        memberEnvelopes: signedState.memberEnvelopes,
      }),
    },
  );
  expect(putPolicyResponse.status).toBe(200);

  expect(sharedWithYouUserIds(publishedEvents)).toEqual([actor.userId]);
});

// The envelopes are already committed before the route publishes, so a transient
// publish failure must not turn a successful group update into a 500.
test("PUT policy still succeeds when publishing shared_with_you throws", async () => {
  const actor = createTestUser();
  await registerUser(actor);
  await authenticate(actor);

  const app = createRouteApp({
    publish: async () => {
      throw new Error("publish transport unavailable");
    },
  });

  const principalId = crypto.randomUUID();
  const signedState = await signSoloGroupState(actor, principalId);

  const putPolicyResponse = await app.request(
    `/principals/group/${principalId}/policy`,
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
        memberEnvelopes: signedState.memberEnvelopes,
      }),
    },
  );
  expect(putPolicyResponse.status).toBe(200);
  const storedPolicy = await putPolicyResponse.json();
  invariant(
    isPrincipalPolicyBundleResponse(storedPolicy),
    "expected principal policy bundle response",
  );
  expect(storedPolicy.currentMemberEnvelopes.envelopes).toEqual(
    signedState.memberEnvelopes,
  );
});
