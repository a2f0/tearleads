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
import { prepareUserForAdminGroup } from "../../../test/helpers/organizationAdmin";
import { getDefaultOrganizationId } from "../../../test/helpers/organizationMembership";
import { createPolicyTestGroup } from "../../../test/helpers/principalPolicy";
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
    { userId: actor.userId },
  ]);
  const groupKem = generateKemSeedAndKeyPair();
  const [wrappedGroupKey] = await wrapDekForRecipients(groupKem.secretKey, [
    actor.kem.publicKey,
  ]);
  invariant(wrappedGroupKey, "expected principal member envelope");
  const memberEnvelopes = [
    {
      userId: actor.userId,
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
    members: [{ userId: actor.userId }],
    projection,
    payloadCiphertext: JSON.stringify({ members: projection }),
    signedAt: "2026-04-08T16:00:00.000Z",
    signerUserId: actor.userId,
    signerUserKeyFingerprint: actor.fingerprint,
    signingPrivateKey: actor.signing.signingPrivateKey,
    memberEnvelopes,
  });
}

async function signAdminsAccessGain(
  actor: ReturnType<typeof createTestUser>,
  member: ReturnType<typeof createTestUser>,
) {
  return prepareUserForAdminGroup({
    actor,
    member,
    organizationId: await getDefaultOrganizationId(actor.userId),
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

test("PUT ungranted policy does not publish shared_with_you", async () => {
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
  await createPolicyTestGroup(actor.userId, principalId);
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
        grants: signedState.grants,
        projection: signedState.projection,
        memberEnvelopes: signedState.memberEnvelopes,
      }),
    },
  );
  expect(putPolicyResponse.status).toBe(200);

  expect(sharedWithYouUserIds(publishedEvents)).toEqual([]);
});

test("PUT granted Admins access notifies only the newly reachable user", async () => {
  const actor = createTestUser();
  await registerUser(actor);
  await authenticate(actor);
  const member = createTestUser();
  await registerUser(member);

  const { adminGroupId, request } = await signAdminsAccessGain(actor, member);
  const publishedEvents: Array<Record<string, unknown>> = [];
  const app = createRouteApp({
    publish: async (event) => {
      publishedEvents.push(event);
    },
  });

  const putPolicyResponse = await app.request(
    `/principals/group/${adminGroupId}/policy`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${actor.token}`,
      },
      body: JSON.stringify(request),
    },
  );

  expect(putPolicyResponse.status).toBe(200);
  expect(sharedWithYouUserIds(publishedEvents)).toEqual([member.userId]);
});

// The policy and envelopes commit before notification delivery, so a transient
// publish failure must not turn a real granted access gain into a 500.
test("PUT granted access still succeeds when shared_with_you publish throws", async () => {
  const actor = createTestUser();
  await registerUser(actor);
  await authenticate(actor);
  const member = createTestUser();
  await registerUser(member);

  const { adminGroupId, request } = await signAdminsAccessGain(actor, member);

  const app = createRouteApp({
    publish: async () => {
      throw new Error("publish transport unavailable");
    },
  });

  const putPolicyResponse = await app.request(
    `/principals/group/${adminGroupId}/policy`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${actor.token}`,
      },
      body: JSON.stringify(request),
    },
  );
  expect(putPolicyResponse.status).toBe(200);
  const storedPolicy = await putPolicyResponse.json();
  invariant(
    isPrincipalPolicyBundleResponse(storedPolicy),
    "expected principal policy bundle response",
  );
  const sortByMemberId = <T extends { userId: string }>(
    envelopes: readonly T[],
  ) =>
    [...envelopes].sort((left, right) =>
      left.userId.localeCompare(right.userId),
    );
  expect(sortByMemberId(storedPolicy.currentMemberEnvelopes.envelopes)).toEqual(
    sortByMemberId(request.memberEnvelopes),
  );
});
