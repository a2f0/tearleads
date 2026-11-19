import {
  type PropsWithChildren,
  useCallback,
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
import { useTearleads } from "../providers/sdk/TearleadsProvider";
import { useSystemBootstrap } from "../providers/system-bootstrap/SystemBootstrapProvider";
import { AccountNameContactSeeder } from "./AccountNameContactSeeder";
import type { AccountNamingState } from "./accountNamingMachine";
import {
  AUTO_PROVISIONING_IDLE,
  type AutoProvisioningStatus,
  AutoProvisioningStatusContext,
  type AutoProvisioningStep,
} from "./autoProvisioningStatus";
import { autoRegisterFailureMessage } from "./registrationRecoveryError";
import {
  INITIAL_REGISTRATION_RUN,
  type RegistrationRun,
  type RegistrationRunEvent,
  registrationStepFor,
  transitionRegistrationRun,
} from "./registrationRunMachine";
import { useAccountNaming } from "./useAccountNaming";
import { useIdentityOnboarding } from "./useIdentityOnboarding";
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
 * identity takes precedence over first-launch onboarding.
 */
function useAutoProvisionIdentity(enabled: boolean) {
  const { features } = useAppHostConfig().profile;
  const interactive =
    features.autoGenerateIdentity &&
    features.autoRegisterIdentity &&
    features.promptAccountName;
  const naming = useAccountNaming();
  const [recoveredFingerprint, setRecoveredFingerprint] = useState<
    string | null
  >(null);
  const { signingFingerprint } = useIdentity();
  const recovered =
    signingFingerprint !== null && signingFingerprint === recoveredFingerprint;
  const onboarding = useIdentityOnboarding(
    enabled && interactive,
    naming.identityNamed,
    setRecoveredFingerprint,
  );
  const automatic = useAutoGenerateIdentity(enabled && !interactive);
  const generation: AutoProvisioningStep =
    onboarding && "request" in onboarding.state
      ? { status: "running" }
      : automatic;
  return {
    generation,
    naming,
    onboarding,
    recovered,
    registration: useAutoRegisterIdentity(enabled, {
      generation,
      naming: naming.state,
      namingSettled: naming.settled,
      recovered,
    }),
  };
}

const AUTO_GENERATE_FAILED_MESSAGE =
  "Could not create an identity automatically. Create one in Identity Manager.";

function useAutoGenerateIdentity(enabled: boolean): AutoProvisioningStep {
  const { features } = useAppHostConfig().profile;
  const { isLocked } = useLocalKeyringLock();
  const {
    generateKey,
    identityDestroyed,
    localIdentityRestoreSettled,
    signingKeyPair,
  } = useIdentity();
  const generationInFlight = useRef(false);
  const [generation, setGeneration] = useState<AutoProvisioningStep>(
    AUTO_PROVISIONING_IDLE,
  );
  useEffect(() => {
    if (
      generationInFlight.current ||
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

    // The in-flight latch keeps a transient re-run (e.g. StrictMode's
    // double-invoke) from starting a second generation, whose re-entrancy
    // refusal would otherwise read as a failure; once a key exists the gate
    // above stops it firing again. A failed run is not retried until reload,
    // so it is reported rather than left as a permanent "creating" state.
    generationInFlight.current = true;
    setGeneration({ status: "running" });
    void generateKey()
      .then(
        (created) => created,
        () => false,
      )
      .then((created) => {
        setGeneration(
          created
            ? AUTO_PROVISIONING_IDLE
            : { message: AUTO_GENERATE_FAILED_MESSAGE, status: "failed" },
        );
      })
      .finally(() => {
        generationInFlight.current = false;
      });
  }, [
    enabled,
    features.autoGenerateIdentity,
    generateKey,
    identityDestroyed,
    isLocked,
    localIdentityRestoreSettled,
    signingKeyPair,
  ]);

  return generation;
}

interface PendingRegistration {
  readonly recovered: boolean;
  readonly generation: AutoProvisioningStep;
  readonly naming: AccountNamingState;
  readonly namingSettled: boolean;
}

/**
 * Whether registration must wait for the user, and the name it carries. A
 * key the autopilot is still installing may yet need a name, a name given
 * before a restart may still be on its way back, a name still owed holds the
 * identity's first registration, and a name given holds it until stored.
 */
function pendingRegistration(pending: PendingRegistration) {
  return {
    accountName:
      pending.naming.status === "named" ? pending.naming.name : undefined,
    awaitingInput:
      pending.generation.status === "running" ||
      !pending.namingSettled ||
      pending.naming.status === "awaiting" ||
      (pending.naming.status === "named" && !pending.naming.sealed),
  };
}

/**
 * Runs {@link transitionRegistrationRun}. The machine is mirrored in a ref so
 * a start the StrictMode double-invoke (or any re-render) repeats before the
 * state commits still sees the run already outstanding.
 */
function useRegistrationRuns(signingFingerprint: string | null) {
  const tearleads = useTearleads();
  const current = useRef(INITIAL_REGISTRATION_RUN);
  const [state, setState] = useState(INITIAL_REGISTRATION_RUN);
  const send = useCallback((event: RegistrationRunEvent) => {
    const next = transitionRegistrationRun(current.current, event);
    if (next !== current.current) {
      current.current = next;
      setState(next);
    }
    return next;
  }, []);
  const start = useCallback(
    (fingerprint: string | null): RegistrationRun | null => {
      const run = { fingerprint, identity: tearleads.identity.snapshot };
      const next = send({ run, type: "started" });
      return next.status === "running" && next.run === run ? run : null;
    },
    [send, tearleads],
  );
  const settle = useCallback(
    (run: RegistrationRun, step: AutoProvisioningStep) => {
      send({
        identity: tearleads.identity.snapshot,
        run,
        step,
        type: "settled",
      });
    },
    [send, tearleads],
  );
  return {
    rearm: state.rearm,
    registration: registrationStepFor(state, signingFingerprint),
    settle,
    start,
  };
}

function useAutoRegisterIdentity(
  enabled: boolean,
  pending: PendingRegistration,
): AutoProvisioningStep {
  const { features } = useAppHostConfig().profile;
  const { login, sessionRestoreSettled } = useCryptoSession();
  const { canRegisterCurrentIdentity, registerCurrentIdentity } =
    useRegisterCurrentIdentity();
  const { ensureBootstrapped, status: systemBootstrapStatus } =
    useSystemBootstrap();
  const { logError } = useLog();
  const { signingFingerprint } = useIdentity();
  const { rearm, registration, settle, start } =
    useRegistrationRuns(signingFingerprint);
  const { accountName, awaitingInput } = pendingRegistration(pending);
  const authenticateIdentity = pending.recovered
    ? login
    : registerCurrentIdentity;
  const currentRegistrationRef = useRef({
    accountName,
    canRegisterCurrentIdentity,
    authenticateIdentity,
  });
  currentRegistrationRef.current = {
    accountName,
    canRegisterCurrentIdentity,
    authenticateIdentity,
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
      systemBootstrapStatus === "error" ||
      awaitingInput
    ) {
      return;
    }
    // registerCurrentIdentity registers, then logs in with the returned
    // challenge. Holding one run at a time keeps the StrictMode double-invoke
    // (and any re-render while the request is outstanding) from firing a
    // second registration; on success canRegisterCurrentIdentity flips false.
    const run = start(signingFingerprint);
    if (!run) {
      return;
    }
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

        return currentRegistrationRef.current.authenticateIdentity({
          accountName: currentRegistrationRef.current.accountName,
        });
      })
      .then(
        // null: bootstrap did not complete and a later change re-arms this
        // effect, so the run is not a failure. false: the login refused or the
        // identity changed underneath; signed-out surfaces offer manual login.
        (registered): AutoProvisioningStep =>
          registered === false
            ? { message: AUTO_SIGN_IN_INCOMPLETE_MESSAGE, status: "failed" }
            : AUTO_PROVISIONING_IDLE,
        (error: unknown): AutoProvisioningStep => {
          // Logged and kept, so signed-out surfaces show the reason beside
          // the manual Login fallback.
          const message = pending.recovered
            ? AUTO_SIGN_IN_INCOMPLETE_MESSAGE
            : autoRegisterFailureMessage(error);
          logError(message, error);
          return { message, status: "failed" };
        },
      )
      .then((step) => settle(run, step));
  }, [
    awaitingInput,
    canRegisterCurrentIdentity,
    enabled,
    ensureBootstrapped,
    features.autoRegisterIdentity,
    logError,
    pending.recovered,
    rearm,
    sessionRestoreSettled,
    settle,
    signingFingerprint,
    start,
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
  const { features } = useAppHostConfig().profile;
  const { generation, naming, onboarding, recovered, registration } =
    useAutoProvisionIdentity(enabled);
  const { contactNamed, settled, state: accountNaming, submit } = naming;
  // Only a profile that asks for names has one to wait for.
  const accountNamingSettled =
    settled || !(features.promptAccountName && features.autoRegisterIdentity);
  const status = useMemo<AutoProvisioningStatus>(
    () => ({
      accountNaming,
      accountNamingSettled,
      enabled,
      generation,
      onboarding,
      recovered,
      registration,
      submitAccountName: submit,
    }),
    [
      accountNaming,
      accountNamingSettled,
      enabled,
      generation,
      onboarding,
      recovered,
      registration,
      submit,
    ],
  );

  return (
    <AutoProvisioningStatusContext.Provider value={status}>
      {accountNaming.status === "named" && !accountNaming.contactNamed && (
        <AccountNameContactSeeder
          fingerprint={accountNaming.fingerprint}
          name={accountNaming.name}
          onNamed={contactNamed}
        />
      )}
      {children}
    </AutoProvisioningStatusContext.Provider>
  );
}
