import { KeyingVerificationError } from "@tearleads/crypto";
import { loadTrustedUserIdentityPins } from "../persistence/identity/trustedUserIdentityPinBatch";
import {
  type TrustedUserIdentityPin,
  TrustedUserIdentityPinCorruptError,
} from "../persistence/trustedUserIdentityPinPersistence";
import { TrustedUserIdentityPinContentionError } from "../persistence/trustedUserIdentityPinTransaction";
import type { ExecSql } from "../sqlite/sqlSchema";
import { DatabaseUnavailableError } from "../sync/databaseUnavailable";
import type {
  StagedUserIdentityOptions,
  StagedUserIdentityResolver,
  TrustedUserIdentityResolver,
  TrustedUserIdentityServiceDependencies,
  ValidatedUserIdentityCandidate,
} from "./types";
import {
  assertTrustedUserIdentityUserId,
  validateRemoteUserIdentity,
} from "./validation";

/** The gateway's own first-sight steps, split so a structural check can stage. */
export interface FirstSightIdentitySteps {
  /** The endpoint's validated candidate for a user; never pinned here. */
  readonly loadCandidate: (
    userId: string,
    identityTrustDomain: string,
  ) => Promise<ValidatedUserIdentityCandidate | null>;
  /**
   * Compare-or-insert one candidate as an `observed` pin; `assertCurrent`
   * runs inside its write transaction so a stale operation commits nothing.
   */
  readonly pinObserved: (
    execSql: ExecSql,
    identity: ValidatedUserIdentityCandidate,
    assertCurrent: () => void,
  ) => Promise<unknown>;
}

interface PinScope {
  readonly assertCurrent: () => void;
  readonly execSql: ExecSql;
  readonly identityTrustDomain: string;
  readonly localUserId: string | null;
}

/** The trust store, account, and runtime generation one operation runs in. */
function capturePinScope(
  dependencies: TrustedUserIdentityServiceDependencies,
): PinScope {
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
  return {
    execSql,
    identityTrustDomain,
    localUserId,
    assertCurrent() {
      if (
        dependencies.getExecSql() !== execSql ||
        dependencies.getLocalUserId() !== localUserId ||
        dependencies.getScopeGeneration?.() !== generation
      )
        throw new DatabaseUnavailableError(
          "The active identity changed while verifying pinned users.",
        );
    },
  };
}

/**
 * Existing pins, self through ordinary resolution, and first sights staged in
 * memory. `fetched` records every endpoint read so a failure can evict it.
 */
function stagedResolver(input: {
  readonly fetched: Set<string>;
  readonly firstSight: FirstSightIdentitySteps;
  readonly pins: ReadonlyMap<string, TrustedUserIdentityPin>;
  readonly resolve: TrustedUserIdentityResolver;
  readonly scope: PinScope;
  readonly staged: Map<string, ValidatedUserIdentityCandidate>;
}): StagedUserIdentityResolver {
  const { scope } = input;
  return async (userId) => {
    scope.assertCurrent();
    if (userId === scope.localUserId) {
      const self = await input.resolve(userId);
      scope.assertCurrent();
      return self;
    }
    const pin = input.pins.get(userId);
    if (pin)
      return validateRemoteUserIdentity({
        candidate: pin,
        identityTrustDomain: scope.identityTrustDomain,
        requestedUserId: userId,
      });
    const known = input.staged.get(userId);
    if (known) return known;
    input.fetched.add(userId);
    const candidate = await input.firstSight.loadCandidate(
      userId,
      scope.identityTrustDomain,
    );
    scope.assertCurrent();
    if (candidate) input.staged.set(userId, candidate);
    return candidate;
  };
}

function pinStoreError(error: unknown): unknown {
  if (error instanceof TrustedUserIdentityPinCorruptError)
    return new KeyingVerificationError("invalid_shape", error.message);
  if (error instanceof TrustedUserIdentityPinContentionError)
    return new DatabaseUnavailableError(
      "Trusted user identity pin store is busy",
    );
  return error;
}

/** Keep direct resolution unchanged; only structural verifiers opt into pins. */
export function withPinnedIdentityResolution(
  dependencies: TrustedUserIdentityServiceDependencies,
  resolve: TrustedUserIdentityResolver,
  firstSight: FirstSightIdentitySteps,
): TrustedUserIdentityResolver {
  return Object.assign(resolve, {
    async withPinnedIdentities<T>(
      userIds: readonly string[],
      verify: (resolve: StagedUserIdentityResolver) => Promise<T>,
      options: StagedUserIdentityOptions,
    ): Promise<T> {
      const captured = capturePinScope(dependencies);
      const scope: PinScope = {
        ...captured,
        assertCurrent() {
          captured.assertCurrent();
          options.assertCurrent?.();
        },
      };
      for (const userId of userIds) assertTrustedUserIdentityUserId(userId);
      // First sights stay in memory until `verify` succeeds for a projection
      // the caller has authenticated: a refusal leaves no durable trace.
      const fetched = new Set<string>();
      const staged = new Map<string, ValidatedUserIdentityCandidate>();
      let published = false;
      try {
        const pins = await loadTrustedUserIdentityPins({
          execSql: scope.execSql,
          identityTrustDomain: scope.identityTrustDomain,
          // Self always rechecks the authoritative local keys and provenance.
          userIds: userIds.filter((userId) => userId !== scope.localUserId),
        });
        scope.assertCurrent();
        const result = await verify(
          stagedResolver({ fetched, firstSight, pins, resolve, scope, staged }),
        );
        if (options.publish)
          for (const candidate of staged.values()) {
            scope.assertCurrent();
            await firstSight.pinObserved(
              scope.execSql,
              candidate,
              scope.assertCurrent,
            );
          }
        scope.assertCurrent();
        published = options.publish;
        return result;
      } catch (error) {
        throw pinStoreError(error);
      } finally {
        // An unpublished answer is unauthenticated even when `verify`
        // succeeded: the caller's signature check may still refuse it. A
        // later lookup must read the endpoint again, not this cached answer.
        if (!published)
          for (const userId of fetched)
            dependencies.remoteSource.invalidate(userId);
      }
    },
  });
}
