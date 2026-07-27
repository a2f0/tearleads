import { purgeOpfsBlobStore } from "@tearleads/client-sdk";
import { useCallback, useState } from "react";

export interface LogoutOptions {
  readonly keepLocalData: boolean;
}

interface ConfirmedLogoutInput extends LogoutOptions {
  readonly getSigningFingerprint: () => string | null;
  readonly log: (message: string) => void;
  readonly logError: (message: string, error: unknown) => void;
  readonly logout: () => void;
  readonly onAfterLocalLogout?: () => void;
  readonly onRemoteLogoutFailure?: () => void;
  readonly purgeWorker: () => Promise<void>;
  readonly session: {
    readonly logoutRemote: () => Promise<boolean>;
  };
  readonly signingFingerprint: string | null;
}

export function useLogoutConfirmationDialogState() {
  const [isOpen, setIsOpen] = useState(false);

  const requestLogout = useCallback(() => {
    setIsOpen(true);
  }, []);

  const closeLogoutDialog = useCallback(() => {
    setIsOpen(false);
  }, []);

  return { closeLogoutDialog, isOpen, requestLogout };
}

async function destroyLocalSessionData(input: {
  readonly logError: (message: string, error: unknown) => void;
  readonly purgeWorker: () => Promise<void>;
  readonly signingFingerprint: string | null;
}): Promise<void> {
  try {
    await input.purgeWorker();
  } catch (error: unknown) {
    input.logError("Failed to wipe local database", error);
  }

  if (input.signingFingerprint) {
    try {
      await purgeOpfsBlobStore(input.signingFingerprint);
    } catch (error: unknown) {
      input.logError("Failed to wipe local blob store", error);
    }
  }
}

export async function runConfirmedLogout(
  input: ConfirmedLogoutInput,
): Promise<boolean> {
  let remoteLoggedOut = false;

  try {
    remoteLoggedOut = await input.session.logoutRemote();
    if (!remoteLoggedOut) {
      input.onRemoteLogoutFailure?.();
      return false;
    }

    input.log("Logged out");
    return true;
  } catch (error: unknown) {
    input.logError("Failed to log out", error);
    input.onRemoteLogoutFailure?.();
    return false;
  } finally {
    if (input.getSigningFingerprint() === input.signingFingerprint) {
      input.logout();
      input.onAfterLocalLogout?.();
      // Destroy local persistence only after the session is torn down, so no
      // store re-reads the SQLite database mid-wipe.
      if (!input.keepLocalData) {
        await destroyLocalSessionData({
          logError: input.logError,
          purgeWorker: input.purgeWorker,
          signingFingerprint: input.signingFingerprint,
        });
      }
    }
  }
}
