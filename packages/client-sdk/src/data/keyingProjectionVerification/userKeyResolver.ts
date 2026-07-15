import { KeyingVerificationError } from "@tearleads/crypto";
import type {
  ProjectionUserKey,
  ProjectionUserKeyResolver,
} from "../keyingProjectionVerification";
import {
  requireTrustedUserIdentityResolver,
  type TrustedUserIdentityResolver,
} from "../trustedUserIdentity";

interface ProjectionUserKeyRuntime {
  readonly log?: (message: string) => void;
  readonly resolveTrustedUserIdentity: TrustedUserIdentityResolver;
}

export function createProjectionUserKeyResolver(
  runtime: ProjectionUserKeyRuntime,
  logPrefix: string,
): ProjectionUserKeyResolver {
  const resolveTrustedUserIdentity = requireTrustedUserIdentityResolver(
    runtime.resolveTrustedUserIdentity,
  );
  const cache = new Map<string, Promise<ProjectionUserKey | null>>();

  return async (userId) => {
    let cached = cache.get(userId);
    if (!cached) {
      cached = resolveTrustedUserIdentity(userId).catch((error: unknown) => {
        // Never downgrade a malformed, changed, or unpinned identity to a
        // soft projection miss. Only transient transport failures retain the
        // historical nullable resolver behavior.
        cache.delete(userId);
        if (error instanceof KeyingVerificationError) {
          throw error;
        }
        runtime.log?.(
          `${logPrefix}: skipped projection key for ${userId} because it could not be loaded.`,
        );
        return null;
      });
      cache.set(userId, cached);
    }

    return cached;
  };
}
