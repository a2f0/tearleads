import { useCallback, useRef } from "react";
import {
  discardCryptoSessionForReload,
  type LocalCryptoSessionPersistence,
  persistableCryptoSessionContext,
  queueCryptoSessionPersistence,
  restoreReloadCryptoSessionContext,
} from "./localCryptoSessionPersistence";
import type { PersistableCryptoSessionState } from "./usePersistCryptoSession";

async function prepareRecordForRestoreReload(input: {
  readonly localPersistence: LocalCryptoSessionPersistence;
  readonly restoreSettled: boolean;
  readonly sessionState: PersistableCryptoSessionState;
  readonly signingFingerprint: string;
}): Promise<void> {
  // Before the saved session is loaded, the live state would overwrite its
  // acknowledgements with an empty list; without the rewrite, a stale record
  // would pin the pre-restore root. Dropping the record is the pre-#2365
  // behavior and loses only the acknowledgements.
  const persisted =
    input.restoreSettled &&
    (await queueCryptoSessionPersistence({
      context: restoreReloadCryptoSessionContext(
        persistableCryptoSessionContext(
          input.sessionState,
          input.sessionState.userIdAcknowledged,
        ),
      ),
      final: true,
      localPersistence: input.localPersistence,
      signingFingerprint: input.signingFingerprint,
    }).catch(() => false));
  if (!persisted) {
    discardCryptoSessionForReload(input.localPersistence);
  }
}

/**
 * Writes the signed-out record a backup restore reloads into, keeping this
 * identity's root acknowledgements (#2365 finding 24). The write is final for
 * the page, so no queued session update replaces it before the reload, and a
 * repeated call waits on the first rather than writing again.
 */
export function usePrepareForRestoreReload(input: {
  readonly localPersistence: LocalCryptoSessionPersistence | null;
  readonly restoreSettled: boolean;
  readonly sessionState: PersistableCryptoSessionState;
  readonly signingFingerprint: string | null;
}): () => Promise<void> {
  const { localPersistence, restoreSettled, signingFingerprint } = input;
  // The latest session is read at call time, so the callback (and the context
  // value holding it) changes only with where the session is persisted.
  const sessionStateRef = useRef(input.sessionState);
  sessionStateRef.current = input.sessionState;
  const pending = useRef<Promise<void> | null>(null);
  return useCallback(() => {
    if (!localPersistence || !signingFingerprint) {
      return Promise.resolve();
    }
    pending.current ??= prepareRecordForRestoreReload({
      localPersistence,
      restoreSettled,
      sessionState: sessionStateRef.current,
      signingFingerprint,
    });
    return pending.current;
  }, [localPersistence, restoreSettled, signingFingerprint]);
}
