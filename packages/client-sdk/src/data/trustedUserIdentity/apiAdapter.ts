import type { ApiClient } from "@tearleads/api-client";
import { KeyingVerificationError } from "@tearleads/crypto";
import type { RemoteUserIdentitySource } from "./types";

/** The sole SDK adapter allowed to consume the raw user-identity endpoint. */
export function createApiUserIdentitySource(
  apiClient: Pick<
    ApiClient,
    "evictUserIdentity" | "getUserIdentity" | "getUserIdentityRequestFailure"
  >,
): RemoteUserIdentitySource {
  return {
    invalidate(userId) {
      apiClient.evictUserIdentity(userId);
    },
    async load(userId) {
      const identity = await apiClient.getUserIdentity(userId);
      if (identity) {
        return identity;
      }

      const failure = apiClient.getUserIdentityRequestFailure(userId);
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
