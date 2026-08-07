import { del, expire, sadd, srem, sscanMembers } from "../adapters/redis";
import type { AppliedInterest } from "./wsRouting";

// Per-session mirror of a socket's interested containers, so a reconnecting
// socket's interest is hydrated server-side instead of requiring the client to
// resend its (possibly thousands-strong) known set. Keyed by user + session so
// a re-login (new session) starts clean and an abandoned session self-expires.
// This is interest, NOT authorization — the HTTP read models gate access.
const WS_INTEREST_PREFIX = "ws-interest:";
// Trails the auth session TTL (SESSION_TTL_SECONDS in middleware/session.ts);
// interest is meaningless once its session is gone, and SADD never sets a TTL so
// every write re-arms it.
const WS_INTEREST_TTL_SECONDS = 86400;

interface InterestStoreDeps {
  readonly del: (key: string) => Promise<void>;
  readonly expire: (key: string, ttlSeconds: number) => Promise<void>;
  readonly sadd: (key: string, member: string) => Promise<void>;
  readonly srem: (key: string, member: string) => Promise<void>;
  readonly sscanMembers: (key: string) => AsyncIterable<string[]>;
}

function interestKey(userId: string, sessionId: string): string {
  return `${WS_INTEREST_PREFIX}${userId}:${sessionId}`;
}

// Single-member SADD/SREM means a thousands-strong interest set is thousands of
// round trips; cap concurrency so a large declaration can't swamp the Redis pool.
const REDIS_MEMBER_BATCH_SIZE = 100;

async function eachMember(
  containerIds: string[],
  op: (containerId: string) => Promise<void>,
): Promise<void> {
  const unique = [...new Set(containerIds)];
  for (let start = 0; start < unique.length; start += REDIS_MEMBER_BATCH_SIZE) {
    await Promise.all(
      unique.slice(start, start + REDIS_MEMBER_BATCH_SIZE).map(op),
    );
  }
}

export function createWsInterestStore(deps: InterestStoreDeps) {
  async function addMembers(
    key: string,
    containerIds: string[],
  ): Promise<void> {
    if (containerIds.length === 0) {
      return;
    }
    await eachMember(containerIds, (id) => deps.sadd(key, id));
    // SADD leaves the set TTL-less, so re-arm expiry on every grow.
    await deps.expire(key, WS_INTEREST_TTL_SECONDS);
  }

  return {
    async load(userId: string, sessionId: string): Promise<string[]> {
      const containerIds: string[] = [];
      for await (const batch of deps.sscanMembers(
        interestKey(userId, sessionId),
      )) {
        containerIds.push(...batch);
      }
      return containerIds;
    },

    async apply(
      userId: string,
      sessionId: string,
      applied: AppliedInterest,
    ): Promise<void> {
      if (!applied) {
        return;
      }
      const key = interestKey(userId, sessionId);
      if (applied.kind === "remove") {
        await eachMember(applied.containerIds, (id) => deps.srem(key, id));
        // SREM never re-arms expiry, so a session that only ever removes
        // interest would let the remaining set decay and expire mid-session,
        // silently dropping events for containers it still cares about.
        await deps.expire(key, WS_INTEREST_TTL_SECONDS);
        return;
      }
      if (applied.kind === "replace") {
        await deps.del(key);
      }
      await addMembers(key, applied.containerIds);
    },

    async clear(userId: string, sessionId: string): Promise<void> {
      await deps.del(interestKey(userId, sessionId));
    },
  };
}

export const wsInterestStore = createWsInterestStore({
  del,
  expire,
  sadd,
  srem,
  sscanMembers,
});
