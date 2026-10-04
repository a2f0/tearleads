import { BoundedCache } from "./ApiCache";

function collectCitedContainerIds(
  value: unknown,
  key: string,
  cited: Set<string>,
): void {
  if (typeof value === "string") {
    if (/containerid$/iu.test(key)) cited.add(value);
    return;
  }
  if (Array.isArray(value)) {
    const listsIds = /containerids$/iu.test(key);
    for (const item of value) {
      if (listsIds && typeof item === "string") cited.add(item);
      else collectCitedContainerIds(item, key, cited);
    }
    return;
  }
  if (value === null || typeof value !== "object") return;
  const entries = Object.entries(value);
  // An access event names its container as `objectId` beside `objectKind`.
  if (Reflect.get(value, "objectKind") === "container") {
    const objectId = Reflect.get(value, "objectId");
    if (typeof objectId === "string") cited.add(objectId);
  }
  for (const [childKey, child] of entries) {
    collectCitedContainerIds(child, childKey, cited);
  }
}

/**
 * Every container a writer projection cites: any `…containerId` field, any
 * `…containerIds` list, and the object id of a container access event,
 * wherever they appear. Reading every such field rather than a fixed set errs
 * toward citing too much, which costs only a refetch.
 */
export function writerProjectionCitedContainerIds(
  projection: unknown,
): ReadonlySet<string> {
  const cited = new Set<string>();
  collectCitedContainerIds(projection, "", cited);
  return cited;
}

function citesAny(
  cited: ReadonlySet<string>,
  containerIds: ReadonlySet<string>,
): boolean {
  for (const id of containerIds) if (cited.has(id)) return true;
  return false;
}

/**
 * A writer projection cache that records which containers each resolved entry
 * cites, so a manifest change to some containers can evict exactly the
 * entries citing them. An entry that has not resolved to a projection has no
 * record and is always evicted.
 */
export class CitingProjectionCache<V> extends BoundedCache<Promise<V | null>> {
  private readonly citations = new WeakMap<
    Promise<V | null>,
    ReadonlySet<string>
  >();

  override set(key: string, value: Promise<V | null>): this {
    void value.then(
      (projection) => {
        if (projection !== null) {
          this.citations.set(
            value,
            writerProjectionCitedContainerIds(projection),
          );
        }
      },
      () => undefined,
    );
    return super.set(key, value);
  }

  /** Evicts the entries that cite any of the containers or are unresolved. */
  evictCiting(containerIds: ReadonlySet<string>): void {
    for (const key of [...this.keys()]) {
      const entry = this.get(key);
      const cited = entry && this.citations.get(entry);
      if (cited && !citesAny(cited, containerIds)) continue;
      this.delete(key);
    }
  }
}

interface CitingProjectionCacheWithFetches<V> {
  readonly cache: CitingProjectionCache<V>;
  /** Shared result fetches still in flight, keyed like the cache. */
  readonly inFlight: Map<string, unknown>;
}

/**
 * Evicts what a manifest change to these containers makes stale: every
 * container or document writer projection citing one of them or not yet
 * resolved, and every fetch still in flight (it may predate the change), which
 * the raised stamp floor keeps from publishing even when no cache slot tracks
 * it. Attachment envelopes wrap to the same KEK targets, so an attachment list
 * stays only while its document's projection does; a list whose document has
 * no cached projection is evicted too.
 */
export function evictWriterProjectionsCiting(
  containerIds: ReadonlySet<string>,
  caches: {
    readonly attachmentLists: BoundedCache<unknown>;
    readonly containers: CitingProjectionCacheWithFetches<unknown>;
    readonly documents: CitingProjectionCacheWithFetches<unknown>;
  },
): void {
  for (const { cache, inFlight } of [caches.containers, caches.documents]) {
    cache.evictCiting(containerIds);
    cache.invalidateInFlight();
    inFlight.clear();
  }
  for (const key of [...caches.attachmentLists.keys()]) {
    if (!caches.documents.cache.has(key)) caches.attachmentLists.delete(key);
  }
}
