import type { ApiClient } from "@tearleads/api-client";
import { toFingerprint } from "@tearleads/crypto";
import { base64ToBytes } from "@tearleads/encoding";

export interface TearleadsUserKey {
  encapsulationPublicKey: string;
  signingKeyFingerprint: string;
  signingPublicKey: string;
  userId: string;
}

export interface TearleadsUserKeys {
  fetch(userId: string): Promise<TearleadsUserKey | null>;
}

export function createTearleadsUserKeys(input: {
  apiClient: ApiClient;
  log: (message: string) => void;
}): TearleadsUserKeys {
  return {
    async fetch(userId) {
      input.log(`Loading user key for userId: ${userId}`);
      const response = await input.apiClient.getEncapsulationKey(userId);
      if (!response) {
        return null;
      }

      const signingPublicKey = base64ToBytes(response.signingPublicKey);
      const signingKeyFingerprint = await toFingerprint(signingPublicKey);
      if (
        response.userId !== userId ||
        response.signingKeyFingerprint !== signingKeyFingerprint
      ) {
        input.log(
          `Skipped user key for ${userId} because the signing fingerprint does not match the public key.`,
        );
        return null;
      }

      return {
        encapsulationPublicKey: response.encapsulationPublicKey,
        signingKeyFingerprint,
        signingPublicKey: response.signingPublicKey,
        userId: response.userId,
      };
    },
  };
}
