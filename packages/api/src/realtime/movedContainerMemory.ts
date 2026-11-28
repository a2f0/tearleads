import { MAX_CONTAINER_PATH_LENGTH } from "@tearleads/validators/util";

export const MOVED_CONTAINER_TTL_MS = 60_000;
const MAX_MOVED_CONTAINERS = 10_000;

interface RememberedMove {
  readonly ancestorIds: readonly string[];
  readonly expiresAt: number;
  readonly updatedAt: string;
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
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
    const existing = this.entries.get(containerId);
    // Do not let an out-of-order older move overwrite a newer remembered move.
    if (
      existing &&
      existing.expiresAt > now &&
      updatedAt < existing.updatedAt
    ) {
      return;
    }
    if (existing) {
      this.entries.delete(containerId);
    } else if (this.entries.size >= this.maxEntries) {
      this.evictOne(now);
    }
    this.entries.set(containerId, {
      ancestorIds: [...ancestorIds],
      expiresAt: now + this.ttlMs,
      updatedAt,
    });
  }

  /**
   * Rewrites a published `[root, ..., containerId]` path if any container in it
   * moved recently and its published prefix disagrees with the remembered new
   * ancestors. Returns `undefined` unchanged when the event carried no path
   * (failing closed).
   */
  resolvePath(
    publishedPath: readonly string[] | undefined,
    now: number,
  ): readonly string[] | undefined {
    if (publishedPath === undefined || publishedPath.length === 0) {
      return publishedPath;
    }
    let current = [...publishedPath];
    const rewrittenNodes = new Set<string>();
    for (let step = 0; step < MAX_CONTAINER_PATH_LENGTH; step++) {
      const next = this.rewriteDeepestStaleNode(current, rewrittenNodes, now);
      if (!next) return current;
      current = next;
    }
    return current;
  }

  /**
   * Rewrites a published `ancestorIds` (`[root, ..., parentId]`) for
   * `containerId`, taking into account moves of `containerId` itself as well as
   * moves of any ancestor along `ancestorIds`.
   */
  resolveAncestors(
    containerId: string,
    publishedAncestors: readonly string[] | undefined,
    now: number,
  ): readonly string[] | undefined {
    if (publishedAncestors === undefined) return undefined;
    const resolved = this.resolvePath(
      [...publishedAncestors, containerId],
      now,
    );
    if (!resolved) return publishedAncestors;
    return resolved.at(-1) === containerId ? resolved.slice(0, -1) : resolved;
  }

  private rewriteDeepestStaleNode(
    path: readonly string[],
    rewrittenNodes: Set<string>,
    now: number,
  ): string[] | null {
    // Scan from leaf toward root so the most specific moved container wins first.
    for (let index = path.length - 1; index >= 0; index--) {
      const nodeId = path[index];
      if (!nodeId || rewrittenNodes.has(nodeId)) continue;
      const remembered = this.readActive(nodeId, now);
      if (!remembered) continue;
      const prefix = path.slice(0, index);
      if (sameIds(prefix, remembered.ancestorIds)) continue;
      rewrittenNodes.add(nodeId);
      const suffix = path.slice(index);
      // Guard against a corrupted/cyclic remembered chain repeating a suffix id.
      const suffixSet = new Set(suffix);
      const cleanAncestors = remembered.ancestorIds.filter(
        (id) => !suffixSet.has(id),
      );
      return [...cleanAncestors, ...suffix].slice(0, MAX_CONTAINER_PATH_LENGTH);
    }
    return null;
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

  private evictOne(now: number): void {
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) {
        this.entries.delete(key);
        return;
      }
    }
    const oldest = this.entries.keys().next().value;
    if (oldest !== undefined) this.entries.delete(oldest);
  }
}
