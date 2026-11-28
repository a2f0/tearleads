import { MAX_CONTAINER_PATH_LENGTH } from "@tearleads/validators/util";

export const MOVED_CONTAINER_TTL_MS = 60_000;
const MAX_MOVED_CONTAINERS = 10_000;

interface RememberedMove {
  readonly ancestorIds: readonly string[];
  readonly expiresAt: number;
  readonly seq: number;
  readonly updatedAtMs: number | null;
  readonly updatedAtRaw: string;
}

function parseTimestampMs(iso: string): number | null {
  const parsed = Date.parse(iso);
  return Number.isNaN(parsed) ? null : parsed;
}

function compareTimestamps(
  aMs: number | null,
  aRaw: string,
  bMs: number | null,
  bRaw: string,
): number {
  if (aMs !== null && bMs !== null && aMs !== bMs) {
    return aMs - bMs;
  }
  return aRaw === bRaw ? 0 : aRaw < bRaw ? -1 : 1;
}

function combineRewrittenPath(
  effectiveAncestors: readonly string[],
  suffix: readonly string[],
): readonly string[] | null {
  const suffixSet = new Set(suffix);
  if (effectiveAncestors.some((id) => suffixSet.has(id))) {
    return null;
  }
  const combined = [...effectiveAncestors, ...suffix];
  return combined.length > MAX_CONTAINER_PATH_LENGTH ? null : combined;
}

function compareMoveOrder(a: RememberedMove, b: RememberedMove): number {
  const byTime = compareTimestamps(
    a.updatedAtMs,
    a.updatedAtRaw,
    b.updatedAtMs,
    b.updatedAtRaw,
  );
  return byTime !== 0 ? byTime : a.seq - b.seq;
}

/**
 * Short-lived memory of recently moved containers and their new ancestor paths.
 *
 * When a container moves out of a watched subtree, an in-flight hint whose
 * publisher read its path before the move committed can still arrive at the hub
 * after the move event. Rewriting any stale prefix on subsequent hints (for the
 * moved container itself or any descendant under it) to the remembered new
 * ancestors closes that window so sockets covering only the old subtree do not
 * receive post-move hints.
 */
export class MovedContainerMemory {
  private readonly entries = new Map<string, RememberedMove>();
  private nextSeq = 0;

  constructor(
    private readonly ttlMs: number = MOVED_CONTAINER_TTL_MS,
    private readonly maxEntries: number = MAX_MOVED_CONTAINERS,
  ) {}

  remember(
    containerId: string,
    ancestorIds: readonly string[],
    updatedAt: string,
    now: number,
  ): void {
    const updatedAtMs = parseTimestampMs(updatedAt);
    const existing = this.entries.get(containerId);
    // Do not let an out-of-order older move overwrite a newer remembered move.
    if (
      existing &&
      existing.expiresAt > now &&
      compareTimestamps(
        updatedAtMs,
        updatedAt,
        existing.updatedAtMs,
        existing.updatedAtRaw,
      ) < 0
    ) {
      return;
    }
    if (existing) {
      this.entries.delete(containerId);
    } else if (this.entries.size >= this.maxEntries) {
      this.evictHead(now);
    }
    this.nextSeq += 1;
    this.entries.set(containerId, {
      ancestorIds: [...ancestorIds],
      expiresAt: now + this.ttlMs,
      seq: this.nextSeq,
      updatedAtMs,
      updatedAtRaw: updatedAt,
    });
  }

  /**
   * Rewrites a published `[root, ..., containerId]` path against any remembered
   * moves. Returns `undefined` when the event carried no path (fail-closed),
   * and `null` if resolving encounters a cycle or path overflow (fail-closed).
   */
  resolvePath(
    publishedPath: readonly string[] | undefined,
    now: number,
  ): readonly string[] | null | undefined {
    if (publishedPath === undefined || publishedPath.length === 0) {
      return publishedPath;
    }
    return this.resolvePathWithMinOrder(publishedPath, null, now, new Set());
  }

  /**
   * Rewrites a published `ancestorIds` (`[root, ..., parentId]`) for
   * `containerId`, taking into account moves of `containerId` itself as well as
   * newer moves of any ancestor along the path. Returns `undefined` when no
   * ancestors were supplied, and `null` on cycle or overflow (fail-closed).
   */
  resolveAncestors(
    containerId: string,
    publishedAncestors: readonly string[] | undefined,
    now: number,
  ): readonly string[] | null | undefined {
    if (publishedAncestors === undefined) return undefined;
    const resolved = this.resolvePath(
      [...publishedAncestors, containerId],
      now,
    );
    if (resolved === null || resolved === undefined) return null;
    return resolved.at(-1) === containerId ? resolved.slice(0, -1) : null;
  }

  private resolvePathWithMinOrder(
    path: readonly string[],
    minOrder: RememberedMove | null,
    now: number,
    visited: ReadonlySet<string>,
  ): readonly string[] | null {
    // Scan leaf-to-root so the most specific moved container wins first; only
    // apply ancestor moves strictly newer than any descendant move already
    // authoritative for the prefix.
    for (let index = path.length - 1; index >= 0; index--) {
      const nodeId = path[index];
      if (!nodeId) continue;
      const entry = this.readActive(nodeId, now);
      if (!entry) continue;
      if (minOrder !== null && compareMoveOrder(entry, minOrder) <= 0) {
        continue;
      }
      if (visited.has(nodeId)) return null;
      const nextVisited = new Set(visited);
      nextVisited.add(nodeId);
      const effectiveAncestors = this.resolvePathWithMinOrder(
        entry.ancestorIds,
        entry,
        now,
        nextVisited,
      );
      if (effectiveAncestors === null) return null;
      return combineRewrittenPath(effectiveAncestors, path.slice(index));
    }
    return path;
  }

  private readActive(containerId: string, now: number): RememberedMove | null {
    const entry = this.entries.get(containerId);
    if (!entry) return null;
    if (entry.expiresAt <= now) {
      this.entries.delete(containerId);
      return null;
    }
    return entry;
  }

  /**
   * Entries share a uniform TTL and are re-inserted on update, so Map head
   * order matches expiry order. Drop expired head entries first, then drop the
   * oldest entry in O(1) if still at capacity.
   */
  private evictHead(now: number): void {
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) {
        this.entries.delete(key);
        continue;
      }
      if (this.entries.size >= this.maxEntries) {
        this.entries.delete(key);
      }
      return;
    }
  }
}
