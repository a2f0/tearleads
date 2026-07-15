import type { ApiClient } from "@tearleads/api-client";
import { KeyingVerificationError } from "@tearleads/crypto";
import type { RemoteUserIdentitySource } from "./types";

/** The sole SDK adapter allowed to consume the raw identity-key endpoint. */
export function createApiUserIdentitySource(
  apiClient: Pick<
    ApiClient,
    | "evictEncapsulationKey"
    | "getEncapsulationKey"
    | "getEncapsulationKeyRequestFailure"
  >,
): RemoteUserIdentitySource {
  return {
    invalidate(userId) {
      apiClient.evictEncapsulationKey(userId);
    },
    async load(userId) {
      const identity = await apiClient.getEncapsulationKey(userId);
      if (identity) {
        return identity;
      }

      const failure = apiClient.getEncapsulationKeyRequestFailure(userId);
      if (failure?.kind === "json" || failure?.kind === "shape") {
        throw new KeyingVerificationError(
          "invalid_shape",
          `Remote user identity response is malformed for ${userId}`,
        );
      }
      return null;
    },
  };
}
