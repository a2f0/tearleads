import {
  type DomainScope,
  purgeOpfsBlobStore,
  type Session,
} from "@tearleads/client-sdk";
import { useCallback, useState } from "react";

export interface LogoutOptions {
  readonly keepLocalData: boolean;
}

interface ConfirmedLogoutInput extends LogoutOptions {
  readonly getSigningFingerprint: () => string | null;
  readonly log: (message: string) => void;
  readonly logError: (message: string, error: unknown) => void;
  readonly onAfterLocalLogout?: () => void;
  readonly onRemoteLogoutFailure?: () => void;
  readonly purgeWorker: () => Promise<void>;
  readonly session: Pick<Session, "logoutRemote">;
  readonly signingFingerprint: string | null;
}

export function useLogoutConfirmationDialogState(scope: DomainScope) {
  const [owner, setOwner] = useState<DomainScope | null>(null);

  const requestLogout = useCallback(() => {
    setOwner(scope);
  }, [scope]);

  const closeLogoutDialog = useCallback(() => {
    setOwner(null);
  }, []);

  return { closeLogoutDialog, isOpen: owner === scope, requestLogout };
}

async function destroyLocalSessionData(input: {
  readonly current: () => boolean;
  readonly logError: (message: string, error: unknown) => void;
  readonly purgeWorker: () => Promise<void>;
  readonly signingFingerprint: string | null;
}): Promise<void> {
  try {
    await input.purgeWorker();
  } catch (error: unknown) {
    input.logError("Failed to wipe local database", error);
  }

  if (input.current() && input.signingFingerprint) {
    try {
      await purgeOpfsBlobStore(input.signingFingerprint, input.current);
    } catch (error: unknown) {
      input.logError("Failed to wipe local blob store", error);
    }
  }
}

export async function runConfirmedLogout(
  input: ConfirmedLogoutInput,
): Promise<boolean> {
  let cleanupCurrent: (() => boolean) | undefined;
  try {
    const remoteLoggedOut = await input.session.logoutRemote(
      async (current) => {
        if (
          input.getSigningFingerprint() !== input.signingFingerprint ||
          !current()
        )
          return;
        cleanupCurrent = current;
        input.onAfterLocalLogout?.();
        if (!input.keepLocalData && current())
          await destroyLocalSessionData({ ...input, current });
      },
    );
    if (cleanupCurrent?.()) {
      if (remoteLoggedOut) input.log("Logged out");
      else input.onRemoteLogoutFailure?.();
    }
    return remoteLoggedOut;
  } catch (error: unknown) {
    if (cleanupCurrent?.()) {
      input.logError("Failed to log out", error);
      input.onRemoteLogoutFailure?.();
    }
    return false;
  }
}
