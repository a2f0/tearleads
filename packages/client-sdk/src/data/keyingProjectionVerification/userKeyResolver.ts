import {
  requireTrustedUserIdentityResolver,
  type TrustedUserIdentityResolver,
} from "../trustedUserIdentity";
import type { ProjectionUserKey, ProjectionUserKeyResolver } from "./types";

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

  const resolve: ProjectionUserKeyResolver = async (userId) => {
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
  // Commitment checks stage first sights through this capability. Without it
  // they fall back to `resolve`, which pins unsigned members on first sight.
  const { withPinnedIdentities } = resolveTrustedUserIdentity;
  return withPinnedIdentities
    ? Object.assign(resolve, { withPinnedIdentities })
    : resolve;
}
