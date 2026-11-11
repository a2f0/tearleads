import { KeyingVerificationError } from "@tearleads/crypto";
import { loadTrustedUserIdentityPins } from "../persistence/identity/trustedUserIdentityPinBatch";
import { TrustedUserIdentityPinCorruptError } from "../persistence/trustedUserIdentityPinPersistence";
import { TrustedUserIdentityPinContentionError } from "../persistence/trustedUserIdentityPinTransaction";
import { DatabaseUnavailableError } from "../sync/databaseUnavailable";
import {
  brandTrustedUserIdentity,
  type TrustedUserIdentityResolver,
  type TrustedUserIdentityServiceDependencies,
} from "./types";
import {
  assertTrustedUserIdentityUserId,
  validateRemoteUserIdentity,
} from "./validation";

/** Keep direct resolution unchanged; only structural verifiers opt into pins. */
export function withPinnedIdentityResolution(
  dependencies: TrustedUserIdentityServiceDependencies,
  resolve: TrustedUserIdentityResolver,
): TrustedUserIdentityResolver {
  return Object.assign(resolve, {
    async withPinnedIdentities<T>(
      userIds: readonly string[],
      verify: (resolve: TrustedUserIdentityResolver) => Promise<T>,
    ): Promise<T> {
      const identityTrustDomain = dependencies.identityTrustDomain;
      if (!identityTrustDomain)
        throw new KeyingVerificationError(
          "missing_dependency",
          "Trusted user identity resolution requires a stable API trust domain",
        );
      const execSql = dependencies.getExecSql();
      if (!execSql)
        throw new DatabaseUnavailableError(
          "Trusted user identity resolution requires a ready SQLite trust store",
        );
      const localUserId = dependencies.getLocalUserId();
      const generation = dependencies.getScopeGeneration?.();
      const assertCurrent = () => {
        if (
          dependencies.getExecSql() !== execSql ||
          dependencies.getLocalUserId() !== localUserId ||
          dependencies.getScopeGeneration?.() !== generation
        )
          throw new DatabaseUnavailableError(
            "The active identity changed while verifying pinned users.",
          );
      };
      for (const userId of userIds) assertTrustedUserIdentityUserId(userId);
      try {
        const pins = await loadTrustedUserIdentityPins({
          execSql,
          identityTrustDomain,
          // Self always rechecks the authoritative local keys and provenance.
          userIds: userIds.filter((userId) => userId !== localUserId),
        });
        assertCurrent();
        const result = await verify(async (userId) => {
          assertCurrent();
          const pin = pins.get(userId);
          const identity = pin
            ? brandTrustedUserIdentity(
                await validateRemoteUserIdentity({
                  candidate: pin,
                  identityTrustDomain,
                  requestedUserId: userId,
                }),
              )
            : await resolve(userId);
          assertCurrent();
          return identity;
        });
        assertCurrent();
        return result;
      } catch (error) {
        if (error instanceof TrustedUserIdentityPinCorruptError)
          throw new KeyingVerificationError("invalid_shape", error.message);
        if (error instanceof TrustedUserIdentityPinContentionError)
          throw new DatabaseUnavailableError(
            "Trusted user identity pin store is busy",
          );
        throw error;
      }
    },
  });
}
