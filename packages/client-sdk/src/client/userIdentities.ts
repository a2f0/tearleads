import { bytesToBase64 } from "@symcrypt/encoding";
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
      const identity = await resolveTrustedUserIdentity(userId);
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
