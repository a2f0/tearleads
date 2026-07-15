import type {
  ProjectionUserKey,
  ProjectionUserKeyResolver,
} from "../keyingProjectionVerification";
import {
  requireTrustedUserIdentityResolver,
  type TrustedUserIdentityResolver,
} from "../trustedUserIdentity";

interface ProjectionUserKeyRuntime {
  readonly resolveTrustedUserIdentity: TrustedUserIdentityResolver;
}

export function createProjectionUserKeyResolver(
  runtime: ProjectionUserKeyRuntime,
): ProjectionUserKeyResolver {
  const resolveTrustedUserIdentity = requireTrustedUserIdentityResolver(
    runtime.resolveTrustedUserIdentity,
  );
  const cache = new Map<string, Promise<ProjectionUserKey | null>>();

  return async (userId) => {
    let cached = cache.get(userId);
    if (!cached) {
      cached = resolveTrustedUserIdentity(userId).catch((error: unknown) => {
        cache.delete(userId);
        throw error;
      });
      cache.set(userId, cached);
    }

    return cached;
  };
}
