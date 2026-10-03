import { useCallback, useRef } from "react";
import {
  discardCryptoSessionForReload,
  type LocalCryptoSessionPersistence,
  type PersistedCryptoSessionContext,
  persistableCryptoSessionContext,
  queueCryptoSessionPersistence,
  restorePersistedCryptoSession,
  restoreReloadCryptoSessionContext,
} from "./localCryptoSessionPersistence";
import type { PersistableCryptoSessionState } from "./usePersistCryptoSession";

/**
 * Why a restore reload dropped the session record, losing its root
 * acknowledgements, or null when it kept them or had none to keep.
 */
export type RestoreReloadDrop = "rewrite_failed" | "rewrite_timed_out" | null;

/**
 * How long the reload waits on the rewrite. An earlier session write that
 * stalls (a keyring that never answers) holds the queue, and the restored app
 * must still reload.
 */
const RESTORE_RELOAD_WRITE_TIMEOUT_MS = 5_000;

interface RestoreReloadInput {
  readonly localPersistence: LocalCryptoSessionPersistence;
  readonly restoreSettled: boolean;
  readonly sessionState: PersistableCryptoSessionState;
  readonly signingFingerprint: string;
  readonly writeTimeoutMs: number;
}

async function restoreReloadContext(
  input: RestoreReloadInput,
): Promise<PersistedCryptoSessionContext | null> {
  if (input.restoreSettled) {
    return restoreReloadCryptoSessionContext(
      persistableCryptoSessionContext(
        input.sessionState,
        input.sessionState.userIdAcknowledged,
      ),
    );
  }
  // Before the saved session is loaded, the live state would overwrite its
  // acknowledgements with an empty list, so the saved record is the source.
  const saved = await restorePersistedCryptoSession({
    localPersistence: input.localPersistence,
    signingFingerprint: input.signingFingerprint,
  });
  return saved && restoreReloadCryptoSessionContext(saved);
}

async function writeRestoreReloadRecord(
  input: RestoreReloadInput,
): Promise<boolean> {
  const context = await restoreReloadContext(input);
  if (!context) {
    return false;
  }
  return queueCryptoSessionPersistence({
    context,
    final: true,
    localPersistence: input.localPersistence,
    signingFingerprint: input.signingFingerprint,
  });
}

function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
): Promise<T | "timed_out"> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timed_out">((resolve) => {
    timer = setTimeout(() => resolve("timed_out"), timeoutMs);
  });
  return Promise.race([operation, timeout]).finally(() => clearTimeout(timer));
}

async function prepareRecordForRestoreReload(
  input: RestoreReloadInput,
): Promise<RestoreReloadDrop> {
  const written = await withTimeout(
    writeRestoreReloadRecord(input).catch(() => false),
    input.writeTimeoutMs,
  );
  if (written === true) {
    return null;
  }
  // Without the rewrite a stale record would pin the pre-restore root, so it
  // is dropped, losing only the acknowledgements. Dropping also seals the key
  // and fences a write still in flight, so nothing lands after the drop.
  const { storage, storageKey } = input.localPersistence;
  const hadRecord = storage.getItem(storageKey) !== null;
  discardCryptoSessionForReload(input.localPersistence);
  if (written === "timed_out") {
    return "rewrite_timed_out";
  }
  return hadRecord ? "rewrite_failed" : null;
}

/**
 * Writes the signed-out record a backup restore reloads into, keeping this
 * identity's root acknowledgements (#2365 finding 24). The write is final for
 * the page, so no queued session update replaces it before the reload, and a
 * repeated call waits on the first rather than writing again. It resolves
 * with why the record was dropped instead, so the caller can log it.
 */
export function usePrepareForRestoreReload(input: {
  readonly localPersistence: LocalCryptoSessionPersistence | null;
  readonly restoreSettled: boolean;
  readonly sessionState: PersistableCryptoSessionState;
  readonly signingFingerprint: string | null;
  readonly writeTimeoutMs?: number | undefined;
}): () => Promise<RestoreReloadDrop> {
  const {
    localPersistence,
    restoreSettled,
    signingFingerprint,
    writeTimeoutMs = RESTORE_RELOAD_WRITE_TIMEOUT_MS,
  } = input;
  // The latest session is read at call time, so the callback (and the context
  // value holding it) changes only with where the session is persisted.
  const sessionStateRef = useRef(input.sessionState);
  sessionStateRef.current = input.sessionState;
  const pending = useRef<Promise<RestoreReloadDrop> | null>(null);
  return useCallback(() => {
    if (!localPersistence || !signingFingerprint) {
      return Promise.resolve(null);
    }
    pending.current ??= prepareRecordForRestoreReload({
      localPersistence,
      restoreSettled,
      sessionState: sessionStateRef.current,
      signingFingerprint,
      writeTimeoutMs,
    });
    return pending.current;
  }, [localPersistence, restoreSettled, signingFingerprint, writeTimeoutMs]);
}
