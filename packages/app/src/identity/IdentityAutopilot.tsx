import {
  type PropsWithChildren,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useCryptoSession } from "../providers/crypto/CryptoSessionProvider";
import { useAppHostConfig } from "../providers/host/AppHostConfigProvider";
import { useIdentity } from "../providers/identity/IdentityProvider";
import { useLocalKeyringLock } from "../providers/local-keyring/LocalKeyringLockProvider";
import { useLog } from "../providers/logging/LogProvider";
import { useSystemBootstrap } from "../providers/system-bootstrap/SystemBootstrapProvider";
import {
  AUTO_REGISTRATION_IDLE,
  AutoProvisioningStatusContext,
  type AutoRegistrationState,
} from "./autoProvisioningStatus";
import { autoRegisterFailureMessage } from "./registrationRecoveryError";
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
function useAutoProvisionIdentity(enabled: boolean): AutoRegistrationState {
  useAutoGenerateIdentity(enabled);
  return useAutoRegisterIdentity(enabled);
}

function useAutoGenerateIdentity(enabled: boolean): void {
  const { features } = useAppHostConfig().profile;
  const { isLocked } = useLocalKeyringLock();
  const {
    generateKey,
    identityDestroyed,
    localIdentityRestoreSettled,
    signingKeyPair,
  } = useIdentity();

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
    void generateKey();
  }, [
    enabled,
    features.autoGenerateIdentity,
    generateKey,
    identityDestroyed,
    isLocked,
    localIdentityRestoreSettled,
    signingKeyPair,
  ]);
}

function useAutoRegisterIdentity(enabled: boolean): AutoRegistrationState {
  const { features } = useAppHostConfig().profile;
  const { sessionRestoreSettled } = useCryptoSession();
  const { canRegisterCurrentIdentity, registerCurrentIdentity } =
    useRegisterCurrentIdentity();
  const { ensureBootstrapped, status: systemBootstrapStatus } =
    useSystemBootstrap();
  const { logError } = useLog();
  const registrationInFlight = useRef(false);
  const [registration, setRegistration] = useState<AutoRegistrationState>(
    AUTO_REGISTRATION_IDLE,
  );
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
      !features.autoRegisterIdentity ||
      !canRegisterCurrentIdentity ||
      // Wait for the persisted-session restore so a returning user's session is
      // adopted instead of being re-registered as a duplicate on every reload.
      !sessionRestoreSettled ||
      // Bootstrap is a precondition for registration. While it is still
      // settling ("waiting") there is nothing to register against yet; after a
      // failed run ("error") retrying immediately would hot-loop, since a failed
      // ensureBootstrapped() flips status running->error and re-fires this
      // effect. In both cases wait for a later input/status change (e.g. the
      // runtime advancing, prerequisites arriving) to re-arm bootstrap rather
      // than spinning here. The manual Register action remains as a fallback.
      systemBootstrapStatus === "waiting" ||
      systemBootstrapStatus === "error"
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
    setRegistration({ status: "running" });
    void ensureBootstrapped()
      .then((result) => {
        // System bootstrap is a hard precondition: only register once the
        // system containers and self contact are in place. ensureBootstrapped
        // never rejects, so a failed/incomplete run resolves with
        // completed: false — skip registration and let a later status/input
        // change re-arm this effect to retry bootstrap (and then register).
        if (
          !result.completed ||
          !currentRegistrationRef.current.canRegisterCurrentIdentity
        ) {
          return null;
        }

        return currentRegistrationRef.current.registerCurrentIdentity();
      })
      .then((registered) => {
        // null: bootstrap did not complete and a later change re-arms this
        // effect, so the run is not a failure. false: the login refused or the
        // identity changed underneath; signed-out surfaces offer manual login.
        setRegistration(
          registered === false
            ? { message: AUTO_SIGN_IN_INCOMPLETE_MESSAGE, status: "failed" }
            : AUTO_REGISTRATION_IDLE,
        );
      })
      .catch((error: unknown) => {
        // Log and swallow to avoid an unhandled rejection; signed-out surfaces
        // show the reason beside the manual Login fallback.
        const message = autoRegisterFailureMessage(error);
        logError(message, error);
        setRegistration({ message, status: "failed" });
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

  return registration;
}

const AUTO_SIGN_IN_INCOMPLETE_MESSAGE =
  "Automatic sign-in did not finish. Log in to continue.";

/**
 * Runs {@link useAutoProvisionIdentity} and publishes its progress through
 * {@link AutoProvisioningStatusContext}, so mini-apps can tell an account that
 * is still being created or signed in from one that needs the user to act.
 * Mounted inside the runtime provider tree so it can reach the identity,
 * crypto-session, and keychain contexts. `enabled` defaults to true; the
 * workspace layer passes the workspace's active state so only the visible
 * workspace provisions.
 */
export function IdentityAutopilot({
  children,
  enabled = true,
}: PropsWithChildren<{
  readonly enabled?: boolean | undefined;
}>) {
  const registration = useAutoProvisionIdentity(enabled);
  const status = useMemo(
    () => ({ enabled, registration }),
    [enabled, registration],
  );

  return (
    <AutoProvisioningStatusContext.Provider value={status}>
      {children}
    </AutoProvisioningStatusContext.Provider>
  );
}
