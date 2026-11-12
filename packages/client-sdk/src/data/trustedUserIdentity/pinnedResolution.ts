import { KeyingVerificationError } from "@tearleads/crypto";
import { loadTrustedUserIdentityPins } from "../persistence/identity/trustedUserIdentityPinBatch";
import { TrustedUserIdentityPinCorruptError } from "../persistence/identity/trustedUserIdentityPinModel";
import type { TrustedUserIdentityPin } from "../persistence/trustedUserIdentityPinPersistence";
import { TrustedUserIdentityPinContentionError } from "../persistence/trustedUserIdentityPinTransaction";
import type { ExecSql } from "../sqlite/sqlSchema";
import { DatabaseUnavailableError } from "../sync/databaseUnavailable";
import type {
  HandoffScope,
  StagedIdentityHandoff,
} from "./stagedIdentityHandoff";
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
   * Compare-or-insert candidates as `observed` pins in one write transaction:
   * a conflict on any of them, or a failed `assertCurrent` at COMMIT, commits
   * none, so a refused scope leaves no partial publication.
   */
  readonly pinObserved: (
    execSql: ExecSql,
    identities: readonly ValidatedUserIdentityCandidate[],
    assertCurrent: () => void,
  ) => Promise<unknown>;
}

interface PinScope extends HandoffScope {
  readonly assertCurrent: () => void;
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
    generation,
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
 * memory; a publishing scope first takes an earlier unpublished scope's
 * handed-off answer. `fetched` records every such read so a failure evicts it.
 */
function stagedResolver(input: {
  readonly fetched: Set<string>;
  readonly firstSight: FirstSightIdentitySteps;
  readonly handoff: StagedIdentityHandoff;
  readonly pins: ReadonlyMap<string, TrustedUserIdentityPin>;
  readonly publish: boolean;
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
    const handed = input.publish
      ? input.handoff.take(scope, userId)
      : undefined;
    if (handed) {
      input.staged.set(userId, handed);
      return handed;
    }
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

/**
 * A refused scope's answers are evicted, so a corrected retry reads the
 * endpoint again. An unpublished answer is unauthenticated even when `verify`
 * succeeded, since the caller's signature check may still refuse it: it stays
 * pending, readable only by a publishing scope that rechecks it, and any
 * other lookup reads the endpoint.
 */
function settleScope(input: {
  readonly completed: boolean;
  readonly published: boolean;
  readonly fetched: ReadonlySet<string>;
  readonly staged: ReadonlyMap<string, ValidatedUserIdentityCandidate>;
  readonly scope: PinScope;
  readonly handoff: StagedIdentityHandoff;
}): void {
  if (!input.completed) input.handoff.evict(input.fetched);
  else if (input.published) input.handoff.published(input.staged.keys());
  else input.handoff.retain(input.scope, input.staged);
}

/** Keep direct resolution unchanged; only structural verifiers opt into pins. */
export function withPinnedIdentityResolution(
  dependencies: TrustedUserIdentityServiceDependencies,
  resolve: TrustedUserIdentityResolver,
  firstSight: FirstSightIdentitySteps,
  handoff: StagedIdentityHandoff,
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
      let completed = false;
      try {
        const pins = await loadTrustedUserIdentityPins({
          execSql: scope.execSql,
          identityTrustDomain: scope.identityTrustDomain,
          // Self always rechecks the authoritative local keys and provenance.
          userIds: userIds.filter((userId) => userId !== scope.localUserId),
        });
        scope.assertCurrent();
        const result = await verify(
          stagedResolver({
            fetched,
            firstSight,
            handoff,
            pins,
            publish: options.publish,
            resolve,
            scope,
            staged,
          }),
        );
        if (options.publish && staged.size > 0) {
          scope.assertCurrent();
          await firstSight.pinObserved(
            scope.execSql,
            [...staged.values()],
            scope.assertCurrent,
          );
        }
        scope.assertCurrent();
        published = options.publish;
        completed = true;
        return result;
      } catch (error) {
        throw pinStoreError(error);
      } finally {
        settleScope({ completed, published, fetched, staged, scope, handoff });
      }
    },
  });
}
