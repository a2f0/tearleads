import type { ApiClient } from "@tearleads/api-client";
import { KeyingVerificationError } from "@tearleads/crypto";
import { ProjectionDependencyUnavailableError } from "../keyingProjectionVerification/dependencyUnavailable";
import type { RemoteUserIdentitySource } from "./types";

/**
 * The sole SDK adapter allowed to consume the raw user-identity endpoint.
 *
 * A null identity has two very different causes and callers must not conflate
 * them: a coded 404 is the server asserting that no such user exists, which is
 * integrity evidence once a signed artifact cites that user, whereas a fetch
 * failure or any other HTTP failure says nothing about the user at all. Only
 * the first stays `null`; the second is a retryable availability error.
 */
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
      if (failure && !(failure.kind === "http" && failure.status === 404)) {
        throw new ProjectionDependencyUnavailableError(
          `Remote user identity for ${userId} is unavailable: ${failure.message}`,
        );
      }
      return null;
    },
  };
}
