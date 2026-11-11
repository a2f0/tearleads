import {
  computeUserIdentityBundleFingerprint,
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  type PrincipalProjectionMember,
  toFingerprint,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import { createTestTrustedUserIdentity } from "../../src/data/trustedUserIdentity/testFixtures";

/** One real identity shared by a fixture's projection and identity resolver. */
export async function createFixtureUserIdentity(input: {
  readonly userId: string;
  readonly signingPublicKey?: Uint8Array;
  readonly encapsulationPublicKey?: Uint8Array;
}) {
  const signingPublicKey =
    input.signingPublicKey ?? generateSigningSeedAndKeyPair().signingPublicKey;
  const encapsulationPublicKey =
    input.encapsulationPublicKey ?? generateKemSeedAndKeyPair().publicKey;
  const identity = createTestTrustedUserIdentity({
    userId: input.userId,
    signingPublicKey,
    encapsulationPublicKey,
    signingKeyFingerprint: await toFingerprint(signingPublicKey),
    encapsulationKeyFingerprint: await toFingerprint(encapsulationPublicKey),
  });
  return {
    identity,
    identityBundleFingerprint: await computeUserIdentityBundleFingerprint({
      identityTrustDomain: "https://api.example.test",
      userId: input.userId,
      signingPublicKey,
      encapsulationPublicKey,
    }),
    response: {
      userId: input.userId,
      signingPublicKey: bytesToBase64(signingPublicKey),
      signingKeyFingerprint: identity.signingKeyFingerprint,
      encapsulationPublicKey: bytesToBase64(encapsulationPublicKey),
      encapsulationKeyFingerprint: identity.encapsulationKeyFingerprint,
    },
  };
}

export function fixtureProjectionMember(
  fixture: Awaited<ReturnType<typeof createFixtureUserIdentity>>,
  role: PrincipalProjectionMember["role"],
): PrincipalProjectionMember {
  return {
    userId: fixture.identity.userId,
    role,
    identityBundleFingerprint: fixture.identityBundleFingerprint,
  };
}

export {
  createMockApiTrustedUserIdentityResolver,
  createTestTrustedUserIdentity,
  createTestTrustedUserIdentityResolver,
  trustedUserIdentityFromResponse,
} from "../../src/data/trustedUserIdentity/testFixtures";
