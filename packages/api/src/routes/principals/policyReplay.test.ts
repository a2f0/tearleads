import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  principalMemberEnvelopes,
  principalMembershipProjection,
  principalStatePayloads,
  principalStates,
} from "@tearleads/api-shared/schema";
import { createTestUser, type TestUser } from "@tearleads/bob-and-alice";
import {
  generateKemSeedAndKeyPair,
  toFingerprint,
  wrapDekForRecipients,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import { isPrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import { eq } from "drizzle-orm";
import invariant from "invariant";
import { authenticate } from "../../../test/helpers/authenticate";
import { signPrincipalStateBundle } from "../../../test/helpers/principalState";
import { registerUser } from "../../../test/helpers/registerUser";
import {
  getCurrentPrincipalState,
  listCurrentPrincipalProjectionMembers,
} from "../../access/read/principalStateStore";
import { routeApp } from "../../routeApp";

type TestPrincipalKem = ReturnType<typeof generateKemSeedAndKeyPair>;

interface TestProjectionMember {
  readonly userId: string;
  readonly role: "admin" | "member";
}

async function createSignedPolicy(input: {
  readonly keyEpoch: number;
  readonly prevStateHash: string | null;
  readonly principalId: string;
  readonly principalKem: TestPrincipalKem;
  readonly projection: TestProjectionMember[];
  readonly recipients: TestUser[];
  readonly signedAt: string;
  readonly signer: TestUser;
  readonly version: number;
}) {
  const memberEnvelopes = await Promise.all(
    input.recipients.map(async (recipient) => {
      const [wrappedKey] = await wrapDekForRecipients(
        input.principalKem.secretKey,
        [recipient.kem.publicKey],
      );
      invariant(wrappedKey, "expected principal member envelope");

      return {
        userId: recipient.userId,
        memberKeyFingerprint: await toFingerprint(recipient.kem.publicKey),
        kemCipherText: bytesToBase64(wrappedKey.kemCipherText),
        wrappedKey: bytesToBase64(wrappedKey.wrappedKey),
      };
    }),
  );

  return signPrincipalStateBundle({
    principalType: "group",
    principalId: input.principalId,
    version: input.version,
    prevStateHash: input.prevStateHash,
    keyEpoch: input.keyEpoch,
    encapsulationPublicKey: bytesToBase64(input.principalKem.publicKey),
    keyFingerprint: await toFingerprint(input.principalKem.publicKey),
    members: input.projection.map((member) => ({ userId: member.userId })),
    projection: input.projection,
    payloadCiphertext: bytesToBase64(
      new TextEncoder().encode(JSON.stringify(input.projection)),
    ),
    signedAt: input.signedAt,
    signerUserId: input.signer.userId,
    signerUserKeyFingerprint: input.signer.fingerprint,
    signingPrivateKey: input.signer.signing.signingPrivateKey,
    memberEnvelopes,
  });
}

function putPolicy(
  actor: TestUser,
  principalId: string,
  policy: Awaited<ReturnType<typeof createSignedPolicy>>,
) {
  return routeApp.request(`/principals/group/${principalId}/policy`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${actor.token}`,
    },
    body: JSON.stringify(policy),
  });
}

test("an exact policy replay succeeds after the signer removes themself", async () => {
  const departingAdmin = createTestUser();
  const replacementAdmin = createTestUser();
  await registerUser(departingAdmin);
  await authenticate(departingAdmin);
  await registerUser(replacementAdmin);

  const principalId = crypto.randomUUID();
  const initialPolicy = await createSignedPolicy({
    principalId,
    principalKem: generateKemSeedAndKeyPair(),
    version: 1,
    prevStateHash: null,
    keyEpoch: 1,
    signedAt: "2026-07-15T12:00:00.000Z",
    signer: departingAdmin,
    projection: [
      {
        userId: departingAdmin.userId,
        role: "admin",
      },
      {
        userId: replacementAdmin.userId,
        role: "member",
      },
    ],
    recipients: [departingAdmin, replacementAdmin],
  });
  const initialResponse = await putPolicy(
    departingAdmin,
    principalId,
    initialPolicy,
  );
  expect(initialResponse.status).toBe(200);
  const initialBundle = await initialResponse.json();
  invariant(
    isPrincipalPolicyBundleResponse(initialBundle),
    "expected initial principal policy bundle",
  );

  const successorPolicy = await createSignedPolicy({
    principalId,
    principalKem: generateKemSeedAndKeyPair(),
    version: 2,
    prevStateHash: initialBundle.currentState.stateHash,
    keyEpoch: 2,
    signedAt: "2026-07-15T12:01:00.000Z",
    signer: departingAdmin,
    projection: [
      {
        userId: replacementAdmin.userId,
        role: "admin",
      },
    ],
    recipients: [replacementAdmin],
  });
  const successorResponse = await putPolicy(
    departingAdmin,
    principalId,
    successorPolicy,
  );
  expect(successorResponse.status).toBe(200);
  const successorBundle = await successorResponse.json();
  invariant(
    isPrincipalPolicyBundleResponse(successorBundle),
    "expected successor principal policy bundle",
  );

  const projectionAfterRemoval = await listCurrentPrincipalProjectionMembers(
    "group",
    principalId,
    db,
  );
  expect(projectionAfterRemoval).toHaveLength(1);
  expect(projectionAfterRemoval[0]).toMatchObject({
    userId: replacementAdmin.userId,
    role: "admin",
  });
  expect(
    projectionAfterRemoval.some(
      (member) => member.userId === departingAdmin.userId,
    ),
  ).toBe(false);

  // Model a lost first response: the now-removed signer sends the byte-for-byte
  // same authenticated request again and must receive the committed bundle.
  const replayResponse = await putPolicy(
    departingAdmin,
    principalId,
    successorPolicy,
  );
  expect(replayResponse.status).toBe(200);
  const replayBundle = await replayResponse.json();
  invariant(
    isPrincipalPolicyBundleResponse(replayBundle),
    "expected replayed principal policy bundle",
  );
  expect(replayBundle.currentState.stateHash).toBe(
    successorBundle.currentState.stateHash,
  );
  expect(replayBundle.currentMemberEnvelopes).toEqual(
    successorBundle.currentMemberEnvelopes,
  );
  expect(replayBundle.previousStates).toHaveLength(1);
}, 10_000);

test("recipient-key rejection rolls back every policy artifact", async () => {
  const actor = createTestUser();
  await registerUser(actor);
  await authenticate(actor);

  const principalId = crypto.randomUUID();
  const principalKem = generateKemSeedAndKeyPair();
  const substitutedRecipientKem = generateKemSeedAndKeyPair();
  const [substitutedEnvelope] = await wrapDekForRecipients(
    principalKem.secretKey,
    [substitutedRecipientKem.publicKey],
  );
  invariant(substitutedEnvelope, "expected substituted member envelope");
  const projection: TestProjectionMember[] = [
    {
      userId: actor.userId,
      role: "admin",
    },
  ];
  const memberEnvelopes = [
    {
      userId: actor.userId,
      memberKeyFingerprint: await toFingerprint(
        substitutedRecipientKem.publicKey,
      ),
      kemCipherText: bytesToBase64(substitutedEnvelope.kemCipherText),
      wrappedKey: bytesToBase64(substitutedEnvelope.wrappedKey),
    },
  ];
  // This state is internally valid and signs the submitted envelope exactly.
  // Rejection happens only after state/payload/projection insertion, when the
  // envelope sink compares its recipient fingerprint to the registered user.
  const signedPolicy = await signPrincipalStateBundle({
    principalType: "group",
    principalId,
    version: 1,
    prevStateHash: null,
    keyEpoch: 1,
    encapsulationPublicKey: bytesToBase64(principalKem.publicKey),
    keyFingerprint: await toFingerprint(principalKem.publicKey),
    members: [{ userId: actor.userId }],
    projection,
    payloadCiphertext: bytesToBase64(
      new TextEncoder().encode(JSON.stringify(projection)),
    ),
    signedAt: "2026-07-15T12:02:00.000Z",
    signerUserId: actor.userId,
    signerUserKeyFingerprint: actor.fingerprint,
    signingPrivateKey: actor.signing.signingPrivateKey,
    memberEnvelopes,
  });

  const response = await putPolicy(actor, principalId, signedPolicy);
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({
    error: `Principal member envelope fingerprint mismatch for user:${actor.userId}`,
  });

  const [states, payloads, storedProjection, envelopes] = await Promise.all([
    db
      .select()
      .from(principalStates)
      .where(eq(principalStates.principalId, principalId)),
    db
      .select()
      .from(principalStatePayloads)
      .where(eq(principalStatePayloads.principalId, principalId)),
    db
      .select()
      .from(principalMembershipProjection)
      .where(eq(principalMembershipProjection.principalId, principalId)),
    db
      .select()
      .from(principalMemberEnvelopes)
      .where(eq(principalMemberEnvelopes.principalId, principalId)),
  ]);
  expect(states).toEqual([]);
  expect(payloads).toEqual([]);
  expect(storedProjection).toEqual([]);
  expect(envelopes).toEqual([]);
  expect(await getCurrentPrincipalState("group", principalId, db)).toBeNull();
}, 10_000);
