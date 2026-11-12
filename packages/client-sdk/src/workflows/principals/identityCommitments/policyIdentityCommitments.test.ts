import { expect, test } from "bun:test";
import {
  computeUserIdentityBundleFingerprint,
  generateKemSeedAndKeyPair,
  KeyingVerificationError,
} from "@tearleads/crypto";
import { createTestTrustedUserIdentity } from "../../../../test/helpers/trustedUserIdentity";
import { collectPrincipalPolicySignerPublicKeys } from "../policyVerification";
import { identityPolicyFixture } from "./policyIdentity.testFixtures";

test("policy signer collection rejects a signed bundle hash different from the pinned full identity", async () => {
  const { bundle, identity } = await identityPolicyFixture();
  const substituted = createTestTrustedUserIdentity({
    ...identity,
    encapsulationPublicKey: generateKemSeedAndKeyPair().publicKey,
  });
  expect(await computeUserIdentityBundleFingerprint(substituted)).not.toBe(
    bundle.currentProjection[0]?.identityBundleFingerprint,
  );
  await expect(
    collectPrincipalPolicySignerPublicKeys({
      bundle,
      resolveTrustedUserIdentity: async () => substituted,
    }),
  ).rejects.toBeInstanceOf(KeyingVerificationError);
});

test("policy signer collection accepts the complete matching identity", async () => {
  const { bundle, identity } = await identityPolicyFixture();
  expect(
    await collectPrincipalPolicySignerPublicKeys({
      bundle,
      resolveTrustedUserIdentity: async () => identity,
    }),
  ).toHaveProperty("signerPublicKeys");
});
