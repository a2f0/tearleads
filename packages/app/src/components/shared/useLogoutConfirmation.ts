import {
  type DomainScope,
  purgeOpfsBlobStore,
  type Session,
} from "@tearleads/client-sdk";
import { useCallback, useReducer } from "react";

import { transitionLogoutDialog } from "./logoutDialogMachine";

export interface LogoutOptions {
  readonly keepLocalData: boolean;
}

interface ConfirmedLogoutInput extends LogoutOptions {
  readonly getSigningFingerprint: () => string | null;
  readonly log: (message: string) => void;
  readonly logError: (message: string, error: unknown) => void;
  readonly onAfterLocalLogout?: () => void;
  readonly onRemoteLogoutFailure?: () => void;
  readonly purgeWorker: (current: () => boolean) => Promise<void>;
  readonly session: Pick<Session, "logoutRemote">;
  readonly signingFingerprint: string | null;
}

export function useLogoutConfirmationDialogState(scope: DomainScope) {
  const [dialog, send] = useReducer(transitionLogoutDialog, {
    status: "closed",
  });
  const requestLogout = useCallback(
    () => send({ type: "open", scope, request: Symbol() }),
    [scope],
  );
  const request =
    dialog.status === "open" && dialog.scope === scope ? dialog.request : null;
  const closeLogoutDialog = useCallback(() => {
    if (request) send({ type: "close", request });
  }, [request]);
  return { closeLogoutDialog, isOpen: request !== null, requestLogout };
}

async function destroyLocalSessionData(input: {
  readonly current: () => boolean;
  readonly logError: (message: string, error: unknown) => void;
  readonly purgeWorker: (current: () => boolean) => Promise<void>;
  readonly signingFingerprint: string | null;
}): Promise<void> {
  try {
    await input.purgeWorker(input.current);
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
