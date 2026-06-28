import { expect, test } from "bun:test";
import { createTestUser } from "@tearleads/bob-and-alice";
import { generateKemSeedAndKeyPair, toFingerprint } from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import { isCurrentPrincipalMemberEnvelopesResponse } from "@tearleads/validators/response";
import invariant from "invariant";
import { authenticate } from "../../../test/helpers/authenticate";
import {
  createProjectionWithAdminSigner,
  signPrincipalStateBundle,
} from "../../../test/helpers/principalState";
import { registerUser } from "../../../test/helpers/registerUser";
import { createRouteApp } from "../../routeApp";

// Sign a minimal group state whose only member is the signing user, so we can
// drive the member-envelopes write the publish behavior under test hangs off of.
async function signSoloGroupState(
  actor: ReturnType<typeof createTestUser>,
  principalId: string,
) {
  const projection = createProjectionWithAdminSigner(actor.userId, [
    { principalType: "user", principalId: actor.userId },
  ]);
  const groupKem = generateKemSeedAndKeyPair();
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
// committing the member-envelopes wraps the group key for each member, granting
// them access to every container shared with the group. As with a direct share,
// publish a scopeless, user-scoped `shared_with_you` per user member so their
// open explorer re-lists root containers without a manual refresh. It must fire
// from the member-envelopes write (not the earlier state write) so the
// recipient's re-list sees a policy bundle that already contains their wrap.
test("PUT member-envelopes publishes a user-scoped shared_with_you for each user member (and PUT state does not)", async () => {
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

  const putStateResponse = await app.request(
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
        projection: signedState.projection,
      }),
    },
  );
  expect(putStateResponse.status).toBe(200);
  const storedState = await putStateResponse.json();
  const stateHash = Reflect.get(storedState, "stateHash");
  invariant(typeof stateHash === "string", "expected state hash");
  // The state write only updates the projection; the member has no wrap yet, so
  // it must not nudge anyone to re-list (they would find no envelope for
  // themselves). Only the member-envelopes write below publishes.
  expect(sharedWithYouUserIds(publishedEvents)).toEqual([]);

  const putMemberEnvelopesResponse = await app.request(
    `/principals/group/${principalId}/member-envelopes`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${actor.token}`,
      },
      body: JSON.stringify({
        stateHash,
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

  expect(sharedWithYouUserIds(publishedEvents)).toEqual([actor.userId]);
});

// The envelopes are already committed before the route publishes, so a transient
// publish failure must not turn a successful group update into a 500.
test("PUT member-envelopes still succeeds when publishing shared_with_you throws", async () => {
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

  const putStateResponse = await app.request(
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
        projection: signedState.projection,
      }),
    },
  );
  expect(putStateResponse.status).toBe(200);
  const storedState = await putStateResponse.json();
  const stateHash = Reflect.get(storedState, "stateHash");
  invariant(typeof stateHash === "string", "expected state hash");

  const putMemberEnvelopesResponse = await app.request(
    `/principals/group/${principalId}/member-envelopes`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${actor.token}`,
      },
      body: JSON.stringify({
        stateHash,
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
  expect(storedMemberEnvelopes.envelopes).toHaveLength(1);
});
