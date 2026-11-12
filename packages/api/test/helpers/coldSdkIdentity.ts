import { createTestTrustedUserIdentityResolver } from "@tearleads/client-sdk/testing";
import { toFingerprint } from "@tearleads/crypto";
import type { TestUser } from "@tearleads/test-utils";
import { API_TEST_IDENTITY_TRUST_DOMAIN } from "./policyProjection";

export function trustedResolver(
  ...users: TestUser[]
): ReturnType<typeof createTestTrustedUserIdentityResolver> {
  const resolvers = users.map((user) =>
    createTestTrustedUserIdentityResolver({
      encapsulationPublicKey: user.kem.publicKey,
      signingKeyFingerprint: user.fingerprint,
      signingPublicKey: user.signing.signingPublicKey,
      userId: user.userId,
    }),
  );
  return async (userId: string) => {
    for (const resolve of resolvers) {
      const identity = await resolve(userId);
      if (identity) {
        return {
          ...identity,
          identityTrustDomain: API_TEST_IDENTITY_TRUST_DOMAIN,
          encapsulationKeyFingerprint: await toFingerprint(
            identity.encapsulationPublicKey,
          ),
        };
      }
    }
    return null;
  };
}
