import type { ExecSql } from "../sqlite/sqlSchema";
import type {
  RemoteUserIdentitySource,
  ValidatedUserIdentityCandidate,
} from "./types";

/** The trust store, account, generation, and domain a candidate was read in. */
export interface HandoffScope {
  readonly execSql: ExecSql;
  readonly generation: unknown;
  readonly identityTrustDomain: string;
  readonly localUserId: string | null;
}

interface PendingCandidate {
  readonly scope: HandoffScope;
  readonly candidate: ValidatedUserIdentityCandidate;
}

/** Far above one operation's distinct first sights; oldest go first. */
const PENDING_LIMIT = 1024;

function sameScope(left: HandoffScope, right: HandoffScope): boolean {
  return (
    left.execSql === right.execSql &&
    left.generation === right.generation &&
    left.identityTrustDomain === right.identityTrustDomain &&
    left.localUserId === right.localUserId
  );
}

/**
 * First sights a successful but unpublished scope staged (a signer collected
 * before its signature verified), handed to a later publishing scope so that
 * publication reads no endpoint again and the endpoint cache keeps the answer
 * it then pins. Until published, an answer is pending: only a publishing
 * scope may take it, and that scope rechecks every signed commitment and
 * signer fingerprint. Any other read of a pending user, by ordinary
 * resolution, an identity link, or an unpublished scope, first discards it
 * and evicts the cached answer, so an unauthenticated answer never reaches
 * them and a corrected retry reads the endpoint again. Every removal other
 * than publication evicts.
 */
export function createStagedIdentityHandoff(evict: (userId: string) => void) {
  const pending = new Map<string, PendingCandidate>();
  const discard = (userId: string) => {
    if (pending.delete(userId)) evict(userId);
  };
  return {
    /** A pending answer for a publishing scope in the same trust scope. */
    take(
      scope: HandoffScope,
      userId: string,
    ): ValidatedUserIdentityCandidate | undefined {
      const entry = pending.get(userId);
      if (!entry) return undefined;
      if (sameScope(entry.scope, scope)) return entry.candidate;
      discard(userId);
      return undefined;
    },
    /** A successful unpublished scope's staged answers become pending. */
    retain(
      scope: HandoffScope,
      staged: ReadonlyMap<string, ValidatedUserIdentityCandidate>,
    ): void {
      for (const [userId, candidate] of staged) {
        pending.delete(userId);
        pending.set(userId, { scope, candidate });
      }
      for (const userId of pending.keys()) {
        if (pending.size <= PENDING_LIMIT) break;
        discard(userId);
      }
    },
    /** Answers now pinned: the cached answer is the published one. */
    published(userIds: Iterable<string>): void {
      for (const userId of userIds) pending.delete(userId);
    },
    discard(userIds: Iterable<string>): void {
      for (const userId of userIds) discard(userId);
    },
    /** Refused answers: discard any pending entry and evict the cache. */
    evict(userIds: Iterable<string>): void {
      for (const userId of userIds) {
        pending.delete(userId);
        evict(userId);
      }
    },
  };
}

export type StagedIdentityHandoff = ReturnType<
  typeof createStagedIdentityHandoff
>;

/**
 * Service dependencies whose endpoint every non-publishing read uses, with
 * the handoff publishing scopes share: pending answers go first.
 */
export function withStagedIdentityHandoff<
  T extends { readonly remoteSource: RemoteUserIdentitySource },
>(
  dependencies: T,
): { readonly dependencies: T; readonly handoff: StagedIdentityHandoff } {
  const source = dependencies.remoteSource;
  const handoff = createStagedIdentityHandoff((userId) =>
    source.invalidate(userId),
  );
  return {
    dependencies: {
      ...dependencies,
      remoteSource: withoutPendingIdentities(source, handoff),
    },
    handoff,
  };
}

function withoutPendingIdentities(
  source: RemoteUserIdentitySource,
  handoff: StagedIdentityHandoff,
): RemoteUserIdentitySource {
  return {
    invalidate(userId) {
      handoff.discard([userId]);
      source.invalidate(userId);
    },
    load(userId) {
      handoff.discard([userId]);
      return source.load(userId);
    },
  };
}
