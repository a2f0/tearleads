import { expect, test } from "bun:test";
import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  toFingerprint,
  unwrapDek,
  wrapDekForRecipients,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
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

/** A directory at epoch 3 whose key is wrapped for `holders`. */
async function directory(holders: readonly Admin[]) {
  const organizationKem = generateKemSeedAndKeyPair();
  const wrapped = await wrapDekForRecipients(
    organizationKem.secretKey,
    holders.map((holder) => holder.kem.publicKey),
  );
  const policy = {
    currentMemberEnvelopes: {
      envelopes: wrapped.map((envelope, index) => ({
        kemCipherText: bytesToBase64(envelope.kemCipherText),
        memberKeyFingerprint: envelope.keyFingerprint,
        userId: holders[index]?.identity.userId ?? "",
        wrappedKey: bytesToBase64(envelope.wrappedKey),
      })),
    },
    currentProjection: holders.map((holder) => holder.member),
    currentState: {
      encapsulationPublicKey: bytesToBase64(organizationKem.publicKey),
      keyEpoch: 3,
      keyFingerprint: await toFingerprint(organizationKem.publicKey),
    },
  } as unknown as OrganizationDirectoryCurrentPolicy;
  return { organizationKem, policy };
}

async function opens(holder: Admin, envelopes: readonly unknown[]) {
  return unwrapDek(
    toRecipientEntries(envelopes as never),
    holder.kem.secretKey,
  );
}

test("an unchanged admin projection keeps the key, epoch and envelopes", async () => {
  const [a, b] = [await admin("a"), await admin("b")];
  const { policy } = await directory([a, b]);
  const keying = await organizationDirectoryKeying({
    currentPolicy: policy,
    currentUserSecretKey: null,
    projection: [b.member, a.member],
    users: [a.identity, b.identity],
  });
  expect(keying).toEqual({
    encapsulationPublicKey: policy.currentState.encapsulationPublicKey,
    keyEpoch: 3,
    keyFingerprint: policy.currentState.keyFingerprint,
    memberEnvelopes: policy.currentMemberEnvelopes.envelopes,
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
  expect(keying.memberEnvelopes.slice(0, 2)).toEqual(
    policy.currentMemberEnvelopes.envelopes,
  );
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
      } as never),
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
