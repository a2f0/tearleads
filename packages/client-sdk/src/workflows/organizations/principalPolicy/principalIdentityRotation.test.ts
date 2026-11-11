import { expect, test } from "bun:test";
import {
  computeUserIdentityBundleFingerprint,
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  KeyingVerificationError,
  toFingerprint,
} from "@tearleads/crypto";
import { createTestTrustedUserIdentity } from "../../../../test/helpers/trustedUserIdentity";
import { rewrapProjectionMemberEnvelopes } from "./principalPolicyRecipients";

test("rotations refuse recipient identities that do not match the continuing member commitment", async () => {
  const signing = generateSigningSeedAndKeyPair();
  const kem = generateKemSeedAndKeyPair();
  const user = createTestTrustedUserIdentity({
    userId: "member",
    signingPublicKey: signing.signingPublicKey,
    signingKeyFingerprint: await toFingerprint(signing.signingPublicKey),
    encapsulationPublicKey: kem.publicKey,
    encapsulationKeyFingerprint: await toFingerprint(kem.publicKey),
  });
  const fingerprint = await computeUserIdentityBundleFingerprint(user);
  const replacement = createTestTrustedUserIdentity({
    ...user,
    signingPublicKey: generateSigningSeedAndKeyPair().signingPublicKey,
  });
  const input = {
    projection: [
      {
        userId: user.userId,
        role: "member" as const,
        identityBundleFingerprint: fingerprint,
      },
    ],
    secretKey: generateKemSeedAndKeyPair().secretKey,
  };
  await expect(
    rewrapProjectionMemberEnvelopes({ ...input, users: [replacement] }),
  ).rejects.toBeInstanceOf(KeyingVerificationError);
  await expect(
    rewrapProjectionMemberEnvelopes({ ...input, users: [user] }),
  ).resolves.toHaveLength(1);
});
