import { useCallback, useState } from "react";
import { useAuthenticateAction } from "../../../identity/useAuthenticateAction";
import type { IdentityContextValue } from "../../../providers/identity/IdentityProvider";
import type { useLog } from "../../../providers/logging/LogProvider";
import type { IdentityBusyState } from "../toolbar/IdentityManagerActionToolbar";
import { useDestroyIdentityDialog } from "./useDestroyIdentityDialog";

type LogContextValue = ReturnType<typeof useLog>;

export function useIdentityManagerIdentityMutations({
  clearSessionError,
  clearSessions,
  destroyKey,
  logError,
  signingFingerprint,
  registerCurrentIdentity,
}: {
  clearSessionError: () => void;
  clearSessions: () => void;
  destroyKey: IdentityContextValue["destroyKey"];
  logError: LogContextValue["logError"];
  signingFingerprint: string | null;
  registerCurrentIdentity: () => Promise<boolean>;
}) {
  // Authentication (with its network-aware failure reason) is shared with the
  // Org Manager gate; registration stays local to this view. Merge the two into
  // the single busy/error the layout renders.
  // Destructure the stable action fns rather than depending on the hook's
  // result object, whose identity changes every render and would defeat the
  // useCallback memoization below.
  const {
    authenticate: runAuthenticate,
    authenticating,
    clearError: clearAuthError,
    error: authError,
  } = useAuthenticateAction();
  const [registerError, setRegisterError] = useState<string | null>(null);
  const [registering, setRegistering] = useState(false);
  const onDestroyed = useCallback(() => {
    clearSessions();
    setRegisterError(null);
    clearAuthError();
    clearSessionError();
  }, [clearSessions, clearAuthError, clearSessionError]);
  const destroyDialog = useDestroyIdentityDialog({
    destroyKey,
    signingFingerprint,
    onDestroyed,
  });

  // Registration and authentication share one error line, so each clears the
  // other's on start — otherwise a stale "Could not register key." would win the
  // `??` below and mask a later authenticate outcome.
  const handleRegisterIdentity = useCallback(async () => {
    setRegistering(true);
    setRegisterError(null);
    clearAuthError();
    try {
      const registered = await registerCurrentIdentity();
      if (!registered) {
        setRegisterError("Could not register key.");
      }
    } catch (error: unknown) {
      logError("Failed to register key", error);
      setRegisterError("Could not register key.");
    } finally {
      setRegistering(false);
    }
  }, [clearAuthError, logError, registerCurrentIdentity]);

  const authenticate = useCallback(async () => {
    setRegisterError(null);
    await runAuthenticate();
  }, [runAuthenticate]);

  const identityBusy: IdentityBusyState = destroyDialog.destroying
    ? "transition"
    : registering
      ? "register"
      : authenticating
        ? "authenticate"
        : null;
  const identityError = registerError ?? authError;

  return {
    ...destroyDialog,
    authenticate,
    handleRegisterIdentity,
    identityBusy,
    identityError,
  };
}
