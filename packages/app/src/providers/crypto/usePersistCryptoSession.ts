import { useEffect } from "react";
import {
  type LocalCryptoSessionPersistence,
  type PersistedCryptoSessionContext,
  persistableCryptoSessionContext,
  queueCryptoSessionPersistence,
} from "./localCryptoSessionPersistence";

export interface PersistableCryptoSessionState
  extends PersistedCryptoSessionContext {
  /**
   * Whether the SDK session's `userId` was acknowledged by the server for the
   * active signing identity. A locally chosen user ID is never persisted as
   * this identity's account: a later restore would replay it through the
   * session's fingerprint binding as if the server had confirmed it.
   */
  readonly userIdAcknowledged: boolean;
}

export function usePersistCryptoSession(input: {
  readonly checkedFingerprint: string | null;
  readonly localPersistence: LocalCryptoSessionPersistence | null;
  readonly logError: (message: string, error: unknown) => void;
  readonly sessionState: PersistableCryptoSessionState;
  readonly signingFingerprint: string | null;
}) {
  const {
    checkedFingerprint,
    localPersistence,
    logError,
    sessionState: {
      authToken,
      containerId,
      defaultOrganizationId,
      isAuthenticated,
      isRoot,
      organizationId,
      rootAcknowledgments,
      userIdAcknowledged,
    },
    signingFingerprint,
  } = input;
  const { userId } = persistableCryptoSessionContext(
    input.sessionState,
    userIdAcknowledged,
  );
  useEffect(() => {
    if (
      !localPersistence ||
      !signingFingerprint ||
      checkedFingerprint !== signingFingerprint
    ) {
      return;
    }

    // A full empty context is used while locking or switching identities. Keep
    // the prior per-identity record intact so returning to that identity can
    // restore its session rather than treating the transition as a logout.
    if (
      !authToken &&
      !containerId &&
      !defaultOrganizationId &&
      !organizationId &&
      !userId
    ) {
      return;
    }

    void queueCryptoSessionPersistence({
      context: {
        authToken,
        containerId,
        defaultOrganizationId,
        isAuthenticated,
        isRoot,
        organizationId,
        rootAcknowledgments,
        userId,
      },
      localPersistence,
      signingFingerprint,
    }).catch((error: unknown) => {
      logError("Failed to persist crypto session", error);
    });
  }, [
    authToken,
    checkedFingerprint,
    containerId,
    defaultOrganizationId,
    isAuthenticated,
    isRoot,
    localPersistence,
    logError,
    organizationId,
    rootAcknowledgments,
    signingFingerprint,
    userId,
  ]);
}
