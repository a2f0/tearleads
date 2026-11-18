import {
  runWithSecurityIncidentReporting,
  type SecurityIncidentReporter,
} from "../../data/shared/securityIncidents";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import {
  createApiUserIdentitySource,
  createTrustedUserIdentityService,
  type StagedUserIdentityOptions,
  type StagedUserIdentityResolver,
  type TrustedUserIdentityResolver,
} from "../../data/trustedUserIdentity";
import type { Identity } from "../identity";
import type { Session } from "../session/sessionTypes";

/** Compose both direct resolution and scoped structural pin reads with reporting. */
export function createRuntimeIdentityResolution(
  dependencies: {
    readonly api: Parameters<typeof createApiUserIdentitySource>[0];
    readonly identity: Pick<
      Identity,
      "encapsulationKeyPair" | "signingKeyPair" | "signingFingerprint"
    >;
    readonly identityTrustDomain: string | null;
    readonly reportSecurityIncident: SecurityIncidentReporter;
    readonly session: Pick<Session, "userId" | "organizationId">;
  },
  getExecSql: () => ExecSql | null,
  getScopeGeneration: () => unknown,
) {
  const trustedUserIdentityService = createTrustedUserIdentityService({
    getExecSql,
    getScopeGeneration,
    getLocalIdentity: () => {
      const { encapsulationKeyPair, signingKeyPair, signingFingerprint } =
        dependencies.identity;
      return encapsulationKeyPair && signingKeyPair
        ? {
            encapsulationPublicKey: encapsulationKeyPair.publicKey,
            signingPublicKey: signingKeyPair.signingPublicKey,
            signingKeyFingerprint: signingFingerprint,
          }
        : null;
    },
    getLocalUserId: () => dependencies.session.userId,
    identityTrustDomain: dependencies.identityTrustDomain,
    remoteSource: createApiUserIdentitySource(dependencies.api),
  });
  const report = <T>(userId: string, operation: () => Promise<T>) =>
    runWithSecurityIncidentReporting(
      dependencies.reportSecurityIncident,
      {
        objectId: userId,
        objectKind: "user",
        operation: "user.identity.resolve",
        organizationId: dependencies.session.organizationId,
      },
      operation,
    );
  const resolveTrustedUserIdentity: TrustedUserIdentityResolver = Object.assign(
    (userId: string) =>
      report(userId, () => trustedUserIdentityService.resolve(userId)),
    {
      withPinnedIdentities: <T>(
        userIds: readonly string[],
        verify: (resolve: StagedUserIdentityResolver) => Promise<T>,
        options: StagedUserIdentityOptions,
      ) => {
        const withPinnedIdentities =
          trustedUserIdentityService.resolve.withPinnedIdentities;
        if (!withPinnedIdentities)
          throw new Error("Trusted identity batch reader is unavailable");
        return withPinnedIdentities(
          userIds,
          (resolve) =>
            verify((userId) => report(userId, () => resolve(userId))),
          options,
        );
      },
    },
  );
  return { trustedUserIdentityService, resolveTrustedUserIdentity };
}

/** A delayed workflow cannot start resolving or pinning an identity in the
 * session that replaced it. The service fences an ongoing pin at commit. */
export function bindSessionIdentityResolver(
  resolve: TrustedUserIdentityResolver,
  signIn: { readonly epoch: number; guard(): () => void },
): () => TrustedUserIdentityResolver {
  let cached:
    | { epoch: number; resolve: TrustedUserIdentityResolver }
    | undefined;
  return () => {
    if (cached?.epoch === signIn.epoch) return cached.resolve;
    const guard = signIn.guard();
    const bound = Object.assign(
      async (userId: string) => {
        guard();
        return resolve(userId);
      },
      {
        withPinnedIdentities: async <T>(
          userIds: readonly string[],
          verify: (resolve: StagedUserIdentityResolver) => Promise<T>,
          options: StagedUserIdentityOptions,
        ) => {
          guard();
          if (!resolve.withPinnedIdentities)
            throw new Error("Trusted identity batch reader is unavailable");
          return resolve.withPinnedIdentities(userIds, verify, options);
        },
      },
    );
    cached = { epoch: signIn.epoch, resolve: bound };
    return bound;
  };
}
