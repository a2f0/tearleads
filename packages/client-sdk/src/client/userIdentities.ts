import { bytesToBase64 } from "@tearleads/encoding";
import { ProjectionDependencyUnavailableError } from "../data/keyingProjectionVerification/dependencyUnavailable";
import {
  requireTrustedUserIdentityResolver,
  type TrustedUserIdentityResolver,
} from "../data/trustedUserIdentity";

export interface ResolvedUserIdentity {
  encapsulationKeyFingerprint: string;
  encapsulationPublicKey: string;
  signingKeyFingerprint: string;
  signingPublicKey: string;
  userId: string;
}

export interface UserIdentities {
  /** `null` when the user is unknown or currently unresolvable; integrity failures throw. */
  resolve(userId: string): Promise<ResolvedUserIdentity | null>;
}

export function createUserIdentities(input: {
  log: (message: string) => void;
  resolveTrustedUserIdentity: TrustedUserIdentityResolver;
}): UserIdentities {
  const resolveTrustedUserIdentity = requireTrustedUserIdentityResolver(
    input.resolveTrustedUserIdentity,
  );
  return {
    async resolve(userId) {
      input.log(`Loading user identity for userId: ${userId}`);
      let identity: Awaited<ReturnType<TrustedUserIdentityResolver>>;
      try {
        identity = await resolveTrustedUserIdentity(userId);
      } catch (error) {
        if (!(error instanceof ProjectionDependencyUnavailableError))
          throw error;
        input.log(
          `User identity for ${userId} is unavailable: ${error.message}`,
        );
        return null;
      }
      if (!identity) {
        return null;
      }

      return {
        encapsulationKeyFingerprint: identity.encapsulationKeyFingerprint,
        encapsulationPublicKey: bytesToBase64(identity.encapsulationPublicKey),
        signingKeyFingerprint: identity.signingKeyFingerprint,
        signingPublicKey: bytesToBase64(identity.signingPublicKey),
        userId: identity.userId,
      };
    },
  };
}
