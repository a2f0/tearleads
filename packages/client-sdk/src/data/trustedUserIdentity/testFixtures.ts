import { base64ToBytes } from "@tearleads/encoding";
import type { UserIdentityResponse } from "@tearleads/validators/response";
import {
  brandTrustedUserIdentity,
  type TrustedUserIdentity,
  type TrustedUserIdentityResolver,
} from "./types";

interface TestTrustedUserIdentityInput {
  readonly encapsulationKeyFingerprint?: string | undefined;
  readonly encapsulationPublicKey?: Uint8Array | undefined;
  readonly signingKeyFingerprint: string;
  readonly signingPublicKey: Uint8Array;
  readonly userId: string;
}

export function createTestTrustedUserIdentity(
  input: TestTrustedUserIdentityInput,
): TrustedUserIdentity {
  return brandTrustedUserIdentity({
    encapsulationKeyFingerprint:
      input.encapsulationKeyFingerprint ?? "test-encapsulation-fingerprint",
    encapsulationPublicKey: input.encapsulationPublicKey ?? new Uint8Array(),
    identityTrustDomain: "https://api.example.test",
    signingKeyFingerprint: input.signingKeyFingerprint,
    signingPublicKey: input.signingPublicKey,
    userId: input.userId,
  });
}

export function createTestTrustedUserIdentityResolver(
  input: TestTrustedUserIdentityInput,
): TrustedUserIdentityResolver {
  const identity = createTestTrustedUserIdentity(input);
  return async (userId) => (userId === identity.userId ? identity : null);
}

export function trustedUserIdentityFromResponse(
  response: UserIdentityResponse,
): TrustedUserIdentity {
  return createTestTrustedUserIdentity({
    encapsulationKeyFingerprint: response.encapsulationKeyFingerprint,
    encapsulationPublicKey: base64ToBytes(response.encapsulationPublicKey),
    signingKeyFingerprint: response.signingKeyFingerprint,
    signingPublicKey: base64ToBytes(response.signingPublicKey),
    userId: response.userId,
  });
}

/** Test-only adapter for lower-level workflow runtimes backed by mock APIs. */
export function createMockApiTrustedUserIdentityResolver(
  loadIdentity: (userId: string) => Promise<UserIdentityResponse | null>,
): TrustedUserIdentityResolver {
  return async (userId) => {
    const response = await loadIdentity(userId);
    return response ? trustedUserIdentityFromResponse(response) : null;
  };
}
