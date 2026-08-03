import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { organizations, users } from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/bob-and-alice";
import {
  generateKemSeedAndKeyPair,
  type PrincipalProjectionMember,
  toFingerprint,
  wrapDekForRecipients,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import { isPrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import { eq } from "drizzle-orm";
import invariant from "invariant";
import { authenticate } from "../../../test/helpers/authenticate";
import { createPrincipalMemberEnvelopes } from "../../../test/helpers/principalMemberEnvelopes";
import {
  createProjectionWithAdminSigner,
  signPrincipalStateBundle,
} from "../../../test/helpers/principalState";
import { registerUser } from "../../../test/helpers/registerUser";
import {
  getCurrentPrincipalState,
  listCurrentPrincipalProjectionMembers,
} from "../../access/read/principalStateStore";
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

async function signAdminsAccessGain(
  actor: ReturnType<typeof createTestUser>,
  member: ReturnType<typeof createTestUser>,
) {
  const [organization] = await db
    .select({ adminGroupId: organizations.adminGroupId })
    .from(users)
    .innerJoin(organizations, eq(organizations.id, users.defaultOrganizationId))
    .where(eq(users.id, actor.userId))
    .limit(1);
  invariant(organization, "expected actor's default organization");

  const currentState = await getCurrentPrincipalState(
    "group",
    organization.adminGroupId,
    db,
  );
  invariant(currentState, "expected provisioned Admins policy");
  const currentProjection = await listCurrentPrincipalProjectionMembers(
    "group",
    organization.adminGroupId,
    db,
  );
  const projection: PrincipalProjectionMember[] = [
    ...currentProjection.map((projectionMember) => ({
      userId: projectionMember.userId,
      role: projectionMember.role,
    })),
    {
      userId: member.userId,
      role: "admin",
    },
  ];
  const groupKem = generateKemSeedAndKeyPair();
  const { memberEnvelopes, stateMembers } =
    await createPrincipalMemberEnvelopes({
      principalSecretKey: groupKem.secretKey,
      projection,
    });
  const signedState = await signPrincipalStateBundle({
    principalType: "group",
    principalId: organization.adminGroupId,
    version: currentState.version + 1,
    prevStateHash: currentState.stateHash,
    keyEpoch: currentState.keyEpoch + 1,
    encapsulationPublicKey: bytesToBase64(groupKem.publicKey),
    keyFingerprint: await toFingerprint(groupKem.publicKey),
    members: stateMembers,
    projection,
    payloadCiphertext: JSON.stringify({ members: projection }),
    signedAt: "2026-04-08T16:00:00.000Z",
    signerUserId: actor.userId,
    signerUserKeyFingerprint: actor.fingerprint,
    signingPrivateKey: actor.signing.signingPrivateKey,
    memberEnvelopes,
  });

  return { adminGroupId: organization.adminGroupId, signedState };
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

  expect(sharedWithYouUserIds(publishedEvents)).toEqual([]);
});

test("PUT granted Admins access notifies only the newly reachable user", async () => {
  const actor = createTestUser();
  await registerUser(actor);
  await authenticate(actor);
  const member = createTestUser();
  await registerUser(member);

  const { adminGroupId, signedState } = await signAdminsAccessGain(
    actor,
    member,
  );
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
      body: JSON.stringify({
        state: signedState.state,
        encryptedPayload: signedState.encryptedPayload,
        projection: signedState.projection,
        memberEnvelopes: signedState.memberEnvelopes,
      }),
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

  const { adminGroupId, signedState } = await signAdminsAccessGain(
    actor,
    member,
  );

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
  const sortByMemberId = <T extends { userId: string }>(
    envelopes: readonly T[],
  ) =>
    [...envelopes].sort((left, right) =>
      left.userId.localeCompare(right.userId),
    );
  expect(sortByMemberId(storedPolicy.currentMemberEnvelopes.envelopes)).toEqual(
    sortByMemberId(signedState.memberEnvelopes),
  );
});
