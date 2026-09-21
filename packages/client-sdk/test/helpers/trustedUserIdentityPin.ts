import type { TrustedUserIdentityPin } from "../../src/data/persistence/trustedUserIdentityPinPersistence";

export function createPin(
  overrides: Partial<TrustedUserIdentityPin> = {},
): TrustedUserIdentityPin {
  return {
    identityTrustDomain: "https://api.example.test/v1",
    userId: "user-1",
    formatVersion: 1,
    signingSuite: "ML-DSA-87",
    signingPublicKey: "signing-public-key-a",
    signingKeyFingerprint: "signing-fingerprint-a",
    encapsulationSuite: "ML-KEM-1024",
    encapsulationPublicKey: "encapsulation-public-key-a",
    encapsulationKeyFingerprint: "encapsulation-fingerprint-a",
    firstSeenAt: "2026-07-15T12:00:00.000Z",
    ...overrides,
  };
}
