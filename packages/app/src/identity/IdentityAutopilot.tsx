import { useEffect, useRef } from "react";
import { useCryptoSession } from "../providers/crypto/CryptoSessionProvider";
import { useAppHostConfig } from "../providers/host/AppHostConfigProvider";
import { useIdentity } from "../providers/identity/IdentityProvider";
import { useLocalKeyringLock } from "../providers/local-keyring/LocalKeyringLockProvider";
import { useLog } from "../providers/logging/LogProvider";
import { useSystemBootstrap } from "../providers/system-bootstrap/SystemBootstrapProvider";
import { useRegisterCurrentIdentity } from "./useRegisterCurrentIdentity";

/**
 * Boot-time identity autopilot. When the host profile opts in (see
 * {@link AppHostFeatureFlags.autoGenerateIdentity} /
 * {@link AppHostFeatureFlags.autoRegisterIdentity}) it derives an identity key
 * pair and/or registers + logs the user in automatically, so a productionized
 * app provisions itself instead of requiring the user to drive the manual
 * Identity Manager flow. Both steps remain available as manual actions, so a
 * profile with the flags off behaves exactly as before.
 *
 * `enabled` lets the host mount the autopilot but hold it off — the regular app
 * mounts every workspace runtime concurrently (only one is visible), so only the
 * active workspace should provision; an inactive workspace would otherwise spin
 * up a worker and register a second org the user never opened.
 *
 * Auto-generation waits for the local keychain to be unlocked and for the
 * initial persisted-identity restore to settle, so a returning user's stored
 * identity is restored rather than clobbered by a freshly generated one.
 */
function useAutoProvisionIdentity(enabled: boolean): void {
  const { features } = useAppHostConfig().profile;
  const { isLocked } = useLocalKeyringLock();
  const {
    generateKey,
    identityDestroyed,
    localIdentityRestoreSettled,
    signingKeyPair,
  } = useIdentity();
  const { sessionRestoreSettled } = useCryptoSession();
  const { canRegisterCurrentIdentity, registerCurrentIdentity } =
    useRegisterCurrentIdentity();
  const { ensureBootstrapped, status: systemBootstrapStatus } =
    useSystemBootstrap();
  const { logError } = useLog();
  const registrationInFlight = useRef(false);
  const currentRegistrationRef = useRef({
    canRegisterCurrentIdentity,
    registerCurrentIdentity,
  });
  currentRegistrationRef.current = {
    canRegisterCurrentIdentity,
    registerCurrentIdentity,
  };

  useEffect(() => {
    if (
      !enabled ||
      !features.autoGenerateIdentity ||
      isLocked ||
      signingKeyPair !== null ||
      !localIdentityRestoreSettled ||
      // Respect an explicit "Destroy Key Pair": don't re-provision until reload.
      identityDestroyed
    ) {
      return;
    }

    // generateKey() guards itself against re-entrancy, so a transient re-run
    // (e.g. StrictMode's double-invoke) is a no-op while generation is in
    // flight; once a key exists the gate above stops it firing again.
    generateKey();
  }, [
    enabled,
    features.autoGenerateIdentity,
    generateKey,
    identityDestroyed,
    isLocked,
    localIdentityRestoreSettled,
    signingKeyPair,
  ]);

  useEffect(() => {
    if (
      !enabled ||
      !features.autoRegisterIdentity ||
      !canRegisterCurrentIdentity ||
      // Wait for the persisted-session restore so a returning user's session is
      // adopted instead of being re-registered as a duplicate on every reload.
      !sessionRestoreSettled ||
      systemBootstrapStatus === "waiting"
    ) {
      return;
    }
    if (registrationInFlight.current) {
      return;
    }

    // registerCurrentIdentity registers, then logs in with the returned
    // challenge. The in-flight latch keeps the StrictMode double-invoke (and any
    // re-render while the request is outstanding) from firing a second
    // registration; on success canRegisterCurrentIdentity flips false.
    registrationInFlight.current = true;
    void ensureBootstrapped()
      .then(() => {
        if (!currentRegistrationRef.current.canRegisterCurrentIdentity) {
          return false;
        }

        return currentRegistrationRef.current.registerCurrentIdentity();
      })
      .catch((error: unknown) => {
        // No UI surface here (unlike the manual Identity Manager flow), so log
        // and swallow to avoid an unhandled rejection; the manual Register
        // action remains available as a fallback.
        logError("Failed to auto-register identity", error);
      })
      .finally(() => {
        registrationInFlight.current = false;
      });
  }, [
    canRegisterCurrentIdentity,
    enabled,
    ensureBootstrapped,
    features.autoRegisterIdentity,
    logError,
    sessionRestoreSettled,
    systemBootstrapStatus,
  ]);
}

/**
 * Headless component that runs {@link useAutoProvisionIdentity}. Mounted inside
 * the runtime provider tree so it can reach the identity, crypto-session, and
 * keychain contexts. `enabled` defaults to true; the workspace layer passes the
 * workspace's active state so only the visible workspace provisions.
 */
export function IdentityAutopilot({
  enabled = true,
}: {
  readonly enabled?: boolean | undefined;
}): null {
  useAutoProvisionIdentity(enabled);
  return null;
}
