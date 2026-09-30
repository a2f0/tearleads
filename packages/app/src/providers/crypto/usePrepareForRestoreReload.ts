import { useCallback, useRef } from "react";
import {
  discardCryptoSessionForReload,
  type LocalCryptoSessionPersistence,
  persistableCryptoSessionContext,
  queueCryptoSessionPersistence,
  restoreReloadCryptoSessionContext,
} from "./localCryptoSessionPersistence";
import type { PersistableCryptoSessionState } from "./usePersistCryptoSession";

/**
 * Writes the signed-out record a backup restore reloads into, keeping this
 * identity's root acknowledgements (#2365 finding 24). The write is final for
 * the page, so no queued session update replaces it before the reload.
 */
export function usePrepareForRestoreReload(input: {
  readonly localPersistence: LocalCryptoSessionPersistence | null;
  readonly sessionState: PersistableCryptoSessionState;
  readonly signingFingerprint: string | null;
}): () => Promise<void> {
  const { localPersistence, signingFingerprint } = input;
  // The latest session is read at call time, so the callback (and the context
  // value holding it) changes only with where the session is persisted.
  const sessionStateRef = useRef(input.sessionState);
  sessionStateRef.current = input.sessionState;
  return useCallback(async () => {
    if (!localPersistence || !signingFingerprint) {
      return;
    }
    const sessionState = sessionStateRef.current;
    const persisted = await queueCryptoSessionPersistence({
      context: restoreReloadCryptoSessionContext(
        persistableCryptoSessionContext(
          sessionState,
          sessionState.userIdAcknowledged,
        ),
      ),
      final: true,
      localPersistence,
      signingFingerprint,
    }).catch(() => false);
    // Without the rewrite, a stale record would pin the pre-restore root;
    // dropping it is the pre-#2365 behavior and loses only the acknowledgements.
    if (!persisted) {
      discardCryptoSessionForReload(localPersistence);
    }
  }, [localPersistence, signingFingerprint]);
}
