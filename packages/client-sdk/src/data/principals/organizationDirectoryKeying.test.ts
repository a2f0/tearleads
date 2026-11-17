import { expect, test } from "bun:test";
import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  toFingerprint,
  unwrapDek,
  wrapDekForRecipients,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import type { PrincipalMemberEnvelopeRequest } from "@tearleads/validators/request";
import { createPrincipalProjectionMember } from "../principalContracts/principalIdentityCommitments";
import { createTestTrustedUserIdentity } from "../trustedUserIdentity/testFixtures";
import {
  type OrganizationDirectoryCurrentPolicy,
  organizationDirectoryKeying,
} from "./organizationDirectoryKeying";
import { principalSecretKeyMatchesState } from "./principalKeyValidation";
import { toRecipientEntries } from "./principalPolicyRecipients";

async function admin(userId: string) {
  const kem = generateKemSeedAndKeyPair();
  const identity = createTestTrustedUserIdentity({
    encapsulationKeyFingerprint: await toFingerprint(kem.publicKey),
    encapsulationPublicKey: kem.publicKey,
    signingKeyFingerprint: `${userId}-signing`,
    signingPublicKey: generateSigningSeedAndKeyPair().signingPublicKey,
    userId,
  });
  return {
    identity,
    kem,
    member: await createPrincipalProjectionMember(identity, "admin"),
  };
}

type Admin = Awaited<ReturnType<typeof admin>>;

/**
 * A directory at epoch 3 whose envelopes wrap `wrappedSecret` (by default the
 * signed key's own secret) for `holders`.
 */
async function directory(
  holders: readonly Admin[],
  wrappedSecret?: Uint8Array,
): Promise<{
  readonly organizationKem: ReturnType<typeof generateKemSeedAndKeyPair>;
  readonly policy: OrganizationDirectoryCurrentPolicy;
}> {
  const organizationKem = generateKemSeedAndKeyPair();
  const wrapped = await wrapDekForRecipients(
    wrappedSecret ?? organizationKem.secretKey,
    holders.map((holder) => holder.kem.publicKey),
  );
  const envelopes: PrincipalMemberEnvelopeRequest[] = wrapped.map(
    (envelope, index) => ({
      kemCipherText: bytesToBase64(envelope.kemCipherText),
      memberKeyFingerprint: envelope.keyFingerprint,
      userId: holders[index]?.identity.userId ?? "",
      wrappedKey: bytesToBase64(envelope.wrappedKey),
    }),
  );
  return {
    organizationKem,
    policy: {
      currentMemberEnvelopes: { envelopes },
      currentProjection: holders.map((holder) => holder.member),
      currentState: {
        encapsulationPublicKey: bytesToBase64(organizationKem.publicKey),
        keyEpoch: 3,
        keyFingerprint: await toFingerprint(organizationKem.publicKey),
      },
    },
  };
}

async function opens(
  holder: Admin,
  envelopes: readonly PrincipalMemberEnvelopeRequest[],
) {
  return unwrapDek(toRecipientEntries(envelopes), holder.kem.secretKey);
}

test("an unchanged admin projection keeps the key, epoch and envelopes", async () => {
  const [a, b] = [await admin("a"), await admin("b")];
  const { policy } = await directory([a, b]);
  const keying = await organizationDirectoryKeying({
    currentPolicy: policy,
    currentUserSecretKey: a.kem.secretKey,
    projection: [b.member, a.member],
    users: [a.identity, b.identity],
  });
  expect(keying).toEqual({
    encapsulationPublicKey: policy.currentState.encapsulationPublicKey,
    keyEpoch: 3,
    keyFingerprint: policy.currentState.keyFingerprint,
    memberEnvelopes: [...policy.currentMemberEnvelopes.envelopes],
  });
});

test("an added admin is wrapped the held key; existing envelopes stay", async () => {
  const [a, b, c] = [await admin("a"), await admin("b"), await admin("c")];
  const { organizationKem, policy } = await directory([a, b]);
  const keying = await organizationDirectoryKeying({
    currentPolicy: policy,
    currentUserSecretKey: a.kem.secretKey,
    projection: [a.member, b.member, c.member],
    users: [a.identity, b.identity, c.identity],
  });
  expect(keying.keyEpoch).toBe(3);
  expect(keying.keyFingerprint).toBe(policy.currentState.keyFingerprint);
  expect(keying.memberEnvelopes.slice(0, 2)).toEqual([
    ...policy.currentMemberEnvelopes.envelopes,
  ]);
  const added = keying.memberEnvelopes.filter(
    (envelope) => envelope.userId === "c",
  );
  expect(await opens(c, added)).toEqual(organizationKem.secretKey);
});

test("growth without the held key, a removal, or a changed member rotates", async () => {
  const [a, b, c] = [await admin("a"), await admin("b"), await admin("c")];
  const { policy } = await directory([a, b]);
  const reidentified = await admin("b");
  for (const [secret, members, users] of [
    [null, [a, b, c], [a, b, c]],
    [a.kem.secretKey, [a], [a]],
    [a.kem.secretKey, [a, reidentified], [a, reidentified]],
  ] as const) {
    const keying = await organizationDirectoryKeying({
      currentPolicy: policy,
      currentUserSecretKey: secret,
      projection: members.map((holder) => holder.member),
      users: users.map((holder) => holder.identity),
    });
    expect(keying.keyEpoch).toBe(4);
    expect(keying.keyFingerprint).not.toBe(policy.currentState.keyFingerprint);
    expect(keying.memberEnvelopes.map((envelope) => envelope.userId)).toEqual(
      members.map((holder) => holder.identity.userId),
    );
    const secretKey = await opens(members[0], keying.memberEnvelopes);
    expect(
      await principalSecretKeyMatchesState(secretKey, {
        encapsulationPublicKey: keying.encapsulationPublicKey,
        keyFingerprint: keying.keyFingerprint,
      }),
    ).toBe(true);
  }
  // A removed admin's envelope opens none of the rotated key.
  const shrunk = await organizationDirectoryKeying({
    currentPolicy: policy,
    currentUserSecretKey: a.kem.secretKey,
    projection: [a.member],
    users: [a.identity],
  });
  await expect(opens(b, shrunk.memberEnvelopes)).rejects.toThrow();
});

test("an envelope that opens another key rotates a kept or grown directory", async () => {
  const [a, b, c] = [await admin("a"), await admin("b"), await admin("c")];
  const { policy } = await directory(
    [a, b],
    generateKemSeedAndKeyPair().secretKey,
  );
  for (const members of [
    [a, b],
    [a, b, c],
  ]) {
    const keying = await organizationDirectoryKeying({
      currentPolicy: policy,
      currentUserSecretKey: a.kem.secretKey,
      projection: members.map((holder) => holder.member),
      users: members.map((holder) => holder.identity),
    });
    expect(keying.keyEpoch).toBe(4);
    expect(keying.keyFingerprint).not.toBe(policy.currentState.keyFingerprint);
  }
  // Without the signer's key nothing can be checked, so the write rotates.
  const unchecked = await organizationDirectoryKeying({
    currentPolicy: policy,
    currentUserSecretKey: null,
    projection: [a.member, b.member],
    users: [a.identity, b.identity],
  });
  expect(unchecked.keyEpoch).toBe(4);
});

test("a signer envelope that fails to open rotates to a key every admin opens", async () => {
  const [a, b] = [await admin("a"), await admin("b")];
  const { policy } = await directory([a, b]);
  const [signerEnvelope, ...others] = policy.currentMemberEnvelopes.envelopes;
  if (!signerEnvelope) throw new Error("Missing signer envelope");
  const tampered: OrganizationDirectoryCurrentPolicy = {
    ...policy,
    currentMemberEnvelopes: {
      envelopes: [
        { ...signerEnvelope, wrappedKey: others[0]?.wrappedKey ?? "" },
        ...others,
      ],
    },
  };
  const keying = await organizationDirectoryKeying({
    currentPolicy: tampered,
    currentUserSecretKey: a.kem.secretKey,
    projection: [a.member, b.member],
    users: [a.identity, b.identity],
  });
  expect(keying.keyEpoch).toBe(4);
  for (const holder of [a, b]) {
    const secretKey = await opens(holder, keying.memberEnvelopes);
    expect(
      await principalSecretKeyMatchesState(secretKey, {
        encapsulationPublicKey: keying.encapsulationPublicKey,
        keyFingerprint: keying.keyFingerprint,
      }),
    ).toBe(true);
  }
});

test("a grown admin may not share an encapsulation key with a retained one", async () => {
  const [a, b] = [await admin("a"), await admin("b")];
  const { policy } = await directory([a, b]);
  const shared = createTestTrustedUserIdentity({
    encapsulationKeyFingerprint: a.identity.encapsulationKeyFingerprint,
    encapsulationPublicKey: a.kem.publicKey,
    signingKeyFingerprint: "c-signing",
    signingPublicKey: generateSigningSeedAndKeyPair().signingPublicKey,
    userId: "c",
  });
  await expect(
    organizationDirectoryKeying({
      currentPolicy: policy,
      currentUserSecretKey: a.kem.secretKey,
      projection: [
        a.member,
        b.member,
        await createPrincipalProjectionMember(shared, "admin"),
      ],
      users: [a.identity, b.identity, shared],
    }),
  ).rejects.toThrow("must not share an encapsulation key");
});

test("a kept key re-serves only the signed envelope fields", async () => {
  const [a, b] = [await admin("a"), await admin("b")];
  const { policy } = await directory([a, b]);
  const served = policy.currentMemberEnvelopes.envelopes;
  const withExtra: OrganizationDirectoryCurrentPolicy = {
    ...policy,
    currentMemberEnvelopes: {
      envelopes: served.map((envelope) =>
        Object.assign({ createdAt: "2026-11-17T00:00:00.000Z" }, envelope),
      ),
    },
  };
  const keying = await organizationDirectoryKeying({
    currentPolicy: withExtra,
    currentUserSecretKey: a.kem.secretKey,
    projection: [a.member, b.member],
    users: [a.identity, b.identity],
  });
  expect(keying.keyEpoch).toBe(3);
  expect(keying.memberEnvelopes).toEqual([...served]);
  for (const envelope of keying.memberEnvelopes)
    expect(Object.keys(envelope).sort()).toEqual([
      "kemCipherText",
      "memberKeyFingerprint",
      "userId",
      "wrappedKey",
    ]);
});
