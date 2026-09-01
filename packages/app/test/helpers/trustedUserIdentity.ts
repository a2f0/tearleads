import {
  createMockApiTrustedUserIdentityResolver,
  createTestTrustedUserIdentity,
} from "@tearleads/client-sdk/testing";
import { toFingerprint } from "@tearleads/crypto";
import type { UserIdentityResponse } from "@tearleads/validators/response";

interface TestRuntimeTrustedIdentityInput {
  readonly encapsulationPublicKey: Uint8Array | null;
  readonly loadRemoteIdentity: (
    userId: string,
  ) => Promise<UserIdentityResponse | null>;
  readonly localUserId: string | null;
  readonly signingKeyFingerprint: string | null;
  readonly signingPublicKey: Uint8Array | null;
}

/** Mirrors the production local-authoritative ordering for test runtimes. */
export function createTestRuntimeTrustedUserIdentityResolver(
  input: TestRuntimeTrustedIdentityInput,
): ReturnType<typeof createMockApiTrustedUserIdentityResolver> {
  const resolveRemoteIdentity = createMockApiTrustedUserIdentityResolver(
    input.loadRemoteIdentity,
  );

  return async (userId: string) => {
    if (
      userId === input.localUserId &&
      input.encapsulationPublicKey &&
      input.signingPublicKey
    ) {
      const [encapsulationKeyFingerprint, signingKeyFingerprint] =
        await Promise.all([
          toFingerprint(input.encapsulationPublicKey),
          input.signingKeyFingerprint ?? toFingerprint(input.signingPublicKey),
        ]);
      return createTestTrustedUserIdentity({
        encapsulationKeyFingerprint,
        encapsulationPublicKey: input.encapsulationPublicKey,
        signingKeyFingerprint,
        signingPublicKey: input.signingPublicKey,
        userId,
      });
    }

    return resolveRemoteIdentity(userId);
  };
}
