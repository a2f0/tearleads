import type { BlobStore } from "@tearleads/client-sdk";
import { readAutomaticPreviewBlobBytes } from "./documentAttachmentUtils";

/** Filesystem reads previews may have outstanding at once, across documents. */
export const PREVIEW_READ_PERMITS = 4;
/** A started read this old is reported as unresponsive local storage. */
export const PREVIEW_READ_STALL_MS = 10_000;

type PreviewBlobStore = Pick<BlobStore, "openByteSource">;
type PreviewBytes = Uint8Array<ArrayBuffer> | null;

export type PreviewReadResult =
  | { readonly status: "read"; readonly bytes: PreviewBytes }
  | { readonly status: "failed" };

type PreviewReadListener = (result: PreviewReadResult) => void;

// One read per storage key. A queued read holds no permit and is dropped when
// its last reader leaves. A started read keeps its permit until the native
// call settles, even when nobody waits for it any more: the BlobStore API
// cannot cancel a read, so releasing early would let repeated navigation
// stack unbounded native calls and buffers behind a stalled filesystem.
type PreviewRead =
  | { status: "queued"; listeners: Set<PreviewReadListener> }
  | {
      status: "reading";
      listeners: Set<PreviewReadListener>;
      stalled: boolean;
    };

export interface PreviewReadHealth {
  /** Started reads that have not settled within the stall window. */
  readonly stalledReads: number;
  /** Keys whose last read failed and that a retry may read again. */
  readonly failedReads: number;
  /** Bumped by a retry; readers re-request keys they still lack. */
  readonly retryGeneration: number;
}

interface PreviewReadPool {
  readonly blobStore: PreviewBlobStore;
  readonly failed: Set<string>;
  readonly healthListeners: Set<() => void>;
  /** Open previews per key; only their failures are reported. */
  readonly interest: Map<string, number>;
  readonly queue: string[];
  readonly reads: Map<string, PreviewRead>;
  active: number;
  health: PreviewReadHealth;
}

const pools = new WeakMap<PreviewBlobStore, PreviewReadPool>();

function poolFor(blobStore: PreviewBlobStore): PreviewReadPool {
  let pool = pools.get(blobStore);
  if (!pool) {
    pool = {
      active: 0,
      blobStore,
      failed: new Set(),
      health: { failedReads: 0, retryGeneration: 0, stalledReads: 0 },
      healthListeners: new Set(),
      interest: new Map(),
      queue: [],
      reads: new Map(),
    };
    pools.set(blobStore, pool);
  }
  return pool;
}

function publishHealth(pool: PreviewReadPool, retried = false): void {
  let stalledReads = 0;
  for (const read of pool.reads.values()) {
    if (read.status === "reading" && read.stalled) stalledReads += 1;
  }
  let failedReads = 0;
  for (const storageKey of pool.failed) {
    if ((pool.interest.get(storageKey) ?? 0) > 0) failedReads += 1;
  }
  const next: PreviewReadHealth = {
    failedReads,
    retryGeneration: pool.health.retryGeneration + (retried ? 1 : 0),
    stalledReads,
  };
  if (
    next.failedReads === pool.health.failedReads &&
    next.retryGeneration === pool.health.retryGeneration &&
    next.stalledReads === pool.health.stalledReads
  )
    return;
  pool.health = next;
  for (const listener of pool.healthListeners) listener();
}

function pump(pool: PreviewReadPool): void {
  while (pool.active < PREVIEW_READ_PERMITS) {
    const storageKey = pool.queue.shift();
    if (storageKey === undefined) return;
    const read = pool.reads.get(storageKey);
    if (read?.status !== "queued") continue;
    start(pool, storageKey, read.listeners);
  }
}

function start(
  pool: PreviewReadPool,
  storageKey: string,
  listeners: Set<PreviewReadListener>,
): void {
  pool.active += 1;
  const read: PreviewRead = { listeners, stalled: false, status: "reading" };
  pool.reads.set(storageKey, read);
  const stallTimer = setTimeout(() => {
    read.stalled = true;
    publishHealth(pool);
  }, PREVIEW_READ_STALL_MS);
  const settle = (result: PreviewReadResult) => {
    clearTimeout(stallTimer);
    pool.active -= 1;
    pool.reads.delete(storageKey);
    if (result.status === "failed") pool.failed.add(storageKey);
    else pool.failed.delete(storageKey);
    publishHealth(pool);
    for (const listener of listeners) listener(result);
    pump(pool);
  };
  readAutomaticPreviewBlobBytes(pool.blobStore, storageKey).then(
    (bytes) => settle({ bytes, status: "read" }),
    () => settle({ status: "failed" }),
  );
}

/**
 * Read one held file for an automatic preview, sharing any read of the same
 * key already in flight. The returned release stops delivery to this caller;
 * the read itself is abandoned only while it is still queued.
 */
export function requestPreviewRead(
  blobStore: PreviewBlobStore,
  storageKey: string,
  listener: PreviewReadListener,
): () => void {
  const pool = poolFor(blobStore);
  const existing = pool.reads.get(storageKey);
  const listeners = existing?.listeners ?? new Set<PreviewReadListener>();
  listeners.add(listener);
  pool.interest.set(storageKey, (pool.interest.get(storageKey) ?? 0) + 1);
  if (!existing) {
    pool.reads.set(storageKey, { listeners, status: "queued" });
    pool.queue.push(storageKey);
    pump(pool);
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    listeners.delete(listener);
    const read = pool.reads.get(storageKey);
    if (read?.status === "queued" && read.listeners.size === 0)
      pool.reads.delete(storageKey);
    const interest = (pool.interest.get(storageKey) ?? 1) - 1;
    if (interest > 0) pool.interest.set(storageKey, interest);
    else pool.interest.delete(storageKey);
    publishHealth(pool);
  };
}

export function getPreviewReadHealth(
  blobStore: PreviewBlobStore,
): PreviewReadHealth {
  return poolFor(blobStore).health;
}

export function subscribePreviewReadHealth(
  blobStore: PreviewBlobStore,
  listener: () => void,
): () => void {
  const pool = poolFor(blobStore);
  pool.healthListeners.add(listener);
  return () => {
    pool.healthListeners.delete(listener);
  };
}

/** Let readers request failed keys again; started reads are never doubled. */
export function retryFailedPreviewReads(blobStore: PreviewBlobStore): void {
  const pool = poolFor(blobStore);
  pool.failed.clear();
  publishHealth(pool, true);
}

/** Started filesystem reads that have not settled. */
export function activePreviewReadCount(blobStore: PreviewBlobStore): number {
  return pools.get(blobStore)?.active ?? 0;
}
