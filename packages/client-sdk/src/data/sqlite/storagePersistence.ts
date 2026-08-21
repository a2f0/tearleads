import type { DatabasePersistenceMode } from "@symcrypt/sqlite-worker/types";

/**
 * Platform-normalized storage persistence policy.
 *
 * Every platform shell (web, capacitor, electrobun) composes its database +
 * blob-store stack from the same primitives, so the decision of *whether* and
 * *how* to persist lives here rather than being re-derived in each app entry
 * point. A policy answers two questions:
 *
 *  1. Which SQLite storage backend should the worker use? (`databasePersistence`)
 *  2. Should we ask the browser to make OPFS durable (exempt from eviction)?
 *     (`requestPersistentStorage`)
 *
 * Both default to the persistent choice; callers on platforms that cannot
 * persist (or that deliberately want ephemeral storage, e.g. tests) override.
 */
export interface StoragePersistencePolicy {
  /** SQLite worker storage backend. */
  readonly databasePersistence: DatabasePersistenceMode;
  /**
   * When `true`, {@link requestPersistentStorage} will call
   * `navigator.storage.persist()` so the OPFS-backed SQLite database and blob
   * store are not evicted under storage pressure.
   */
  readonly requestPersistentStorage: boolean;
}

/**
 * Persist everything that can be persisted: OPFS-SAHPool SQLite + a durable
 * storage request. This is the right default for every shipping platform.
 */
export const PERSISTENT_STORAGE_POLICY: StoragePersistencePolicy = {
  databasePersistence: "opfs-sahpool",
  requestPersistentStorage: true,
};

/**
 * Keep everything in memory and make no durability request. Matches the
 * historical behavior; useful for tests and for contexts known to lack OPFS.
 */
export const EPHEMERAL_STORAGE_POLICY: StoragePersistencePolicy = {
  databasePersistence: "memory",
  requestPersistentStorage: false,
};

/**
 * Whether the persistent OPFS-SAHPool backend can run in the current context.
 *
 * OPFS itself is reachable from both window and worker contexts via
 * `navigator.storage.getDirectory`. The SAHPool VFS additionally needs the
 * `Worker`/WASM machinery, which the worker provides; from the main thread we
 * can only check the OPFS surface, which is the meaningful gate for picking a
 * policy. The worker performs the authoritative check and hard-fails if the VFS
 * cannot be installed.
 */
export function isPersistentStorageSupported(): boolean {
  return (
    typeof navigator === "object" &&
    navigator !== null &&
    typeof navigator.storage === "object" &&
    navigator.storage !== null &&
    typeof navigator.storage.getDirectory === "function"
  );
}

/**
 * Resolve the persistence policy for the current platform.
 *
 * Pass an explicit `preferred` policy to force a choice (a platform shell that
 * knows it always has OPFS, or a test that wants ephemeral storage). With no
 * argument it auto-detects: persistent when OPFS is available, ephemeral
 * otherwise. Auto-detection never throws — the worker is responsible for the
 * hard failure when persistence is requested but unavailable.
 */
export function resolveStoragePersistencePolicy(
  preferred?: StoragePersistencePolicy,
): StoragePersistencePolicy {
  if (preferred) {
    return preferred;
  }

  return isPersistentStorageSupported()
    ? PERSISTENT_STORAGE_POLICY
    : EPHEMERAL_STORAGE_POLICY;
}

export type RequestPersistentStorageResult =
  | "persisted"
  | "not-persisted"
  | "unsupported"
  | "not-requested";

/**
 * Ask the browser to make this origin's storage durable so OPFS data (the
 * SQLite database and the blob store) survives eviction.
 *
 * Safe to call repeatedly and on every platform: it is a no-op when the policy
 * does not request persistence, when the API is unavailable, or when it throws.
 * The returned value reports what happened for logging/telemetry; callers
 * generally do not need to branch on it.
 */
export async function requestPersistentStorage(
  policy: StoragePersistencePolicy,
): Promise<RequestPersistentStorageResult> {
  if (!policy.requestPersistentStorage) {
    return "not-requested";
  }

  const storage =
    typeof navigator === "object" && navigator !== null
      ? navigator.storage
      : undefined;

  if (!storage || typeof storage.persist !== "function") {
    return "unsupported";
  }

  try {
    if (
      typeof storage.persisted === "function" &&
      (await storage.persisted())
    ) {
      return "persisted";
    }

    return (await storage.persist()) ? "persisted" : "not-persisted";
  } catch {
    return "unsupported";
  }
}
