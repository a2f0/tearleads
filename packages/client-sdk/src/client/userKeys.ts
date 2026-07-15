import { bytesToBase64 } from "@tearleads/encoding";
import {
  requireTrustedUserIdentityResolver,
  type TrustedUserIdentityResolver,
} from "../data/trustedUserIdentity";

export interface UserKey {
  encapsulationKeyFingerprint: string;
  encapsulationPublicKey: string;
  signingKeyFingerprint: string;
  signingPublicKey: string;
  userId: string;
}

export interface UserKeys {
  fetch(userId: string): Promise<UserKey | null>;
}

export function createUserKeys(input: {
  log: (message: string) => void;
  resolveTrustedUserIdentity: TrustedUserIdentityResolver;
}): UserKeys {
  const resolveTrustedUserIdentity = requireTrustedUserIdentityResolver(
    input.resolveTrustedUserIdentity,
  );
  return {
    async fetch(userId) {
      input.log(`Loading user key for userId: ${userId}`);
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
