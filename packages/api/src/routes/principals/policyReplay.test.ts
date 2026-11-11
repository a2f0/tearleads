import { expect, spyOn, test } from "bun:test";
import { type DatabaseSession, db } from "@tearleads/api-shared/postgres";
import {
  principalMemberEnvelopes,
  principalMembershipProjection,
  principalStatePayloads,
  principalStates,
} from "@tearleads/api-shared/schema";
import {
  generateKemSeedAndKeyPair,
  toFingerprint,
  wrapDekForRecipients,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import { createTestUser, type TestUser } from "@tearleads/test-utils";
import { isCommitOrganizationGroupPolicyResponse } from "@tearleads/validators/response";
import { eq } from "drizzle-orm";
import invariant from "invariant";
import { authenticate } from "../../../test/helpers/authenticate";
import { groupPolicyPayload } from "../../../test/helpers/groupPolicyPayload";
import { addOrganizationMember } from "../../../test/helpers/organizationMembership";
import {
  createPolicyTestGroup,
  getDefaultOrganizationId,
  submitOrganizationGroupPolicyCommit,
} from "../../../test/helpers/principalPolicy";
import { signPrincipalStateBundle } from "../../../test/helpers/principalState";
import { registerUser } from "../../../test/helpers/registerUser";
import {
  getCurrentPrincipalState,
  listCurrentPrincipalProjectionMembers,
} from "../../access/read/principalStateStore";
import * as principalStateStore from "../../access/write/principalStateStore";
import * as groupPolicyName from "../../workflows/principals/groupPolicyName";

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
    payloadCiphertext: await groupPolicyPayload(
      input.principalId,
      input.projection,
    ),
    signedAt: input.signedAt,
    signerUserId: input.signer.userId,
    signerUserKeyFingerprint: input.signer.fingerprint,
    signingPrivateKey: input.signer.signing.signingPrivateKey,
    memberEnvelopes,
  });
}

async function putPolicy(
  actor: TestUser,
  principalId: string,
  policy: Awaited<ReturnType<typeof createSignedPolicy>>,
) {
  return submitOrganizationGroupPolicyCommit({
    actor,
    groupId: principalId,
    groupPolicy: policy,
    organizationId: await getDefaultOrganizationId(actor.userId),
  });
}

test("an exact policy replay succeeds after the signer removes themself", async () => {
  const departingAdmin = createTestUser();
  const replacementAdmin = createTestUser();
  await registerUser(departingAdmin);
  await authenticate(departingAdmin);
  await registerUser(replacementAdmin);

  const principalId = crypto.randomUUID();
  await addOrganizationMember({
    actor: departingAdmin,
    member: replacementAdmin,
    organizationId: await getDefaultOrganizationId(departingAdmin.userId),
  });
  await createPolicyTestGroup(departingAdmin.userId, principalId);
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
    isCommitOrganizationGroupPolicyResponse(initialBundle),
    "expected initial compound policy bundle",
  );

  const successorPolicy = await createSignedPolicy({
    principalId,
    principalKem: generateKemSeedAndKeyPair(),
    version: 2,
    prevStateHash: initialBundle.groupPolicy.head.stateHash,
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
    isCommitOrganizationGroupPolicyResponse(successorBundle),
    "expected successor compound policy bundle",
  );
  // One acknowledged `createdAt` stands for the state and its payload, so both
  // rows must carry it exactly, including where SQLite evaluates each default.
  for (const policy of [
    successorBundle.groupPolicy,
    successorBundle.organizationPolicy,
  ]) {
    const [state] = await db
      .select({ createdAt: principalStates.createdAt })
      .from(principalStates)
      .where(eq(principalStates.stateHash, policy.head.stateHash));
    const [payload] = await db
      .select({ createdAt: principalStatePayloads.createdAt })
      .from(principalStatePayloads)
      .where(eq(principalStatePayloads.stateHash, policy.head.stateHash));
    expect(state?.createdAt.toISOString()).toBe(policy.createdAt);
    expect(payload?.createdAt.toISOString()).toBe(policy.createdAt);
  }

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
    isCommitOrganizationGroupPolicyResponse(replayBundle),
    "expected replayed compound policy bundle",
  );
  expect(replayBundle.groupPolicy.head).toEqual(
    successorBundle.groupPolicy.head,
  );
  expect(replayBundle.groupPolicy.createdAt).toBe(
    successorBundle.groupPolicy.createdAt,
  );
}, 10_000);

async function readPolicyArtifacts(
  executor: DatabaseSession,
  principalId: string,
) {
  return Promise.all([
    executor
      .select()
      .from(principalStates)
      .where(eq(principalStates.principalId, principalId)),
    executor
      .select()
      .from(principalStatePayloads)
      .where(eq(principalStatePayloads.principalId, principalId)),
    executor
      .select()
      .from(principalMembershipProjection)
      .where(eq(principalMembershipProjection.principalId, principalId)),
    executor
      .select()
      .from(principalMemberEnvelopes)
      .where(eq(principalMemberEnvelopes.principalId, principalId)),
  ]);
}

test.each([
  {
    name: "recipient-key substitution is rejected before storing any policy artifact",
    substituteRecipient: true,
  },
  {
    name: "invalid group metadata rolls back every staged policy artifact",
    substituteRecipient: false,
  },
])(
  "$name",
  async ({ substituteRecipient }) => {
    const actor = createTestUser();
    await registerUser(actor);
    await authenticate(actor);

    const principalId = crypto.randomUUID();
    await createPolicyTestGroup(actor.userId, principalId);
    const principalKem = generateKemSeedAndKeyPair();
    const recipientKem = substituteRecipient
      ? generateKemSeedAndKeyPair()
      : actor.kem;
    const [envelope] = await wrapDekForRecipients(principalKem.secretKey, [
      recipientKem.publicKey,
    ]);
    invariant(envelope, "expected member envelope");
    const projection: TestProjectionMember[] = [
      {
        userId: actor.userId,
        role: "admin",
      },
    ];
    const memberEnvelopes = [
      {
        userId: actor.userId,
        memberKeyFingerprint: await toFingerprint(recipientKem.publicKey),
        kemCipherText: bytesToBase64(envelope.kemCipherText),
        wrappedKey: bytesToBase64(envelope.wrappedKey),
      },
    ];
    // Both states sign their exact envelopes and payload. A substituted recipient
    // now fails before persistence. With the registered recipient, the deliberately
    // invalid metadata instead reaches the real post-insertion metadata guard.
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

    let staged: Awaited<ReturnType<typeof readPolicyArtifacts>> | undefined;
    const persistence = spyOn(
      principalStateStore,
      "storeVerifiedPrincipalStateInTransaction",
    );
    const assertNamePreserved = groupPolicyName.assertGroupPolicyNamePreserved;
    const observer = spyOn(
      groupPolicyName,
      "assertGroupPolicyNamePreserved",
    ).mockImplementation(async (tx, input, previous) => {
      if (input.state.principalId === principalId) {
        staged = await readPolicyArtifacts(tx, principalId);
      }
      return assertNamePreserved(tx, input, previous);
    });
    try {
      const response = await putPolicy(actor, principalId, signedPolicy);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: substituteRecipient
          ? `Principal member envelope identity key mismatch for ${actor.userId}`
          : "Invalid initial group metadata",
      });
      expect(
        persistence.mock.calls.filter(
          ([input]) => input.state.principalId === principalId,
        ),
      ).toHaveLength(substituteRecipient ? 0 : 1);
      if (substituteRecipient) {
        expect(observer).not.toHaveBeenCalled();
        expect(staged).toBeUndefined();
      } else {
        invariant(
          staged,
          "expected all policy artifacts before metadata validation",
        );
        for (const rows of staged) expect(rows).toHaveLength(1);
        expect(staged[2][0]?.identityBundleFingerprint).toBe(
          signedPolicy.projection[0]?.identityBundleFingerprint,
        );
        expect(staged[3][0]?.memberKeyFingerprint).toBe(
          await toFingerprint(actor.kem.publicKey),
        );
      }
    } finally {
      observer.mockRestore();
      persistence.mockRestore();
    }
    const [states, payloads, storedProjection, envelopes] =
      await readPolicyArtifacts(db, principalId);
    expect(states).toEqual([]);
    expect(payloads).toEqual([]);
    expect(storedProjection).toEqual([]);
    expect(envelopes).toEqual([]);
    expect(await getCurrentPrincipalState("group", principalId, db)).toBeNull();
  },
  10_000,
);
