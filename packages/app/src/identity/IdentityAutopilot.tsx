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
import { sealPendingAccountNaming } from "../providers/identity/accountNamingPersistence";
import { useIdentity } from "../providers/identity/IdentityProvider";
import { useLocalKeyringLock } from "../providers/local-keyring/LocalKeyringLockProvider";
import { useLog } from "../providers/logging/LogProvider";
import { useTearleads } from "../providers/sdk/TearleadsProvider";
import { useSystemBootstrap } from "../providers/system-bootstrap/SystemBootstrapProvider";
import { AccountNameContactSeeder } from "./AccountNameContactSeeder";
import {
  type AccountNamingState,
  personalOrganizationName,
} from "./accountNamingMachine";
import {
  AUTO_PROVISIONING_IDLE,
  type AutoProvisioningStatus,
  AutoProvisioningStatusContext,
  type AutoProvisioningStep,
} from "./autoProvisioningStatus";
import { autoRegisterFailureMessage } from "./registrationRecoveryError";
import { type AccountNaming, useAccountNaming } from "./useAccountNaming";
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
 * identity is restored rather than clobbered by a freshly generated one. With
 * {@link AppHostFeatureFlags.promptAccountName}, the identity it generates
 * then waits for the user's name before it registers.
 */
function useAutoProvisionIdentity(enabled: boolean): {
  generation: AutoProvisioningStep;
  naming: AccountNaming;
  registration: AutoProvisioningStep;
} {
  const naming = useAccountNaming();
  const generation = useAutoGenerateIdentity(enabled, naming.identityGenerated);
  return {
    generation,
    naming,
    registration: useAutoRegisterIdentity(enabled, {
      generation,
      naming: naming.state,
      namingSettled: naming.settled,
    }),
  };
}

const AUTO_GENERATE_FAILED_MESSAGE =
  "Could not create an identity automatically. Create one in Identity Manager.";

function useAutoGenerateIdentity(
  enabled: boolean,
  onGenerated: (fingerprint: string) => void,
): AutoProvisioningStep {
  const { localIdentityNamespace, profile } = useAppHostConfig();
  const { features } = profile;
  const { createLocalKeyring, isLocked } = useLocalKeyringLock();
  const {
    generateKey,
    identityDestroyed,
    localIdentityRestoreSettled,
    signingKeyPair,
  } = useIdentity();
  const { logError } = useLog();
  const promptAccountName =
    features.promptAccountName && features.autoRegisterIdentity;
  const generationInFlight = useRef(false);
  const [generation, setGeneration] = useState<AutoProvisioningStep>(
    AUTO_PROVISIONING_IDLE,
  );
  // Before the new identity is stored: the prompt is owed from here on, and
  // sealed first, so a restart before it is answered still asks.
  const beforePersist = useCallback(
    async (signingFingerprint: string) => {
      onGenerated(signingFingerprint);
      await sealPendingAccountNaming({
        createLocalKeyring,
        namespace: localIdentityNamespace ?? null,
        signingFingerprint,
      }).catch((error: unknown) => {
        logError("Could not save the pending account name.", error);
      });
    },
    [createLocalKeyring, localIdentityNamespace, logError, onGenerated],
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
    void generateKey(promptAccountName ? { beforePersist } : undefined)
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
    beforePersist,
    enabled,
    features.autoGenerateIdentity,
    generateKey,
    identityDestroyed,
    isLocked,
    localIdentityRestoreSettled,
    promptAccountName,
    signingKeyPair,
  ]);

  return generation;
}

/**
 * A provisioning step that reports only for the identity it ran for, so a
 * switch to another identity never inherits its progress or failure.
 */
function useIdentityScopedStep(signingFingerprint: string | null) {
  const [scoped, setScoped] = useState<{
    readonly fingerprint: string | null;
    readonly step: AutoProvisioningStep;
  }>({ fingerprint: null, step: AUTO_PROVISIONING_IDLE });
  const setStep = useCallback(
    (fingerprint: string | null, step: AutoProvisioningStep) => {
      setScoped({ fingerprint, step });
    },
    [],
  );
  const step =
    scoped.fingerprint === signingFingerprint
      ? scoped.step
      : AUTO_PROVISIONING_IDLE;
  return [step, setStep] as const;
}

interface PendingRegistration {
  readonly generation: AutoProvisioningStep;
  readonly naming: AccountNamingState;
  readonly namingSettled: boolean;
}

/**
 * Whether registration must wait for the user, and the org name it carries. A
 * key the autopilot is still installing may yet need a name, a name given
 * before a restart may still be on its way back, and a name still owed holds
 * the identity's first registration.
 */
function pendingRegistration(pending: PendingRegistration) {
  return {
    awaitingInput:
      pending.generation.status === "running" ||
      !pending.namingSettled ||
      pending.naming.status === "awaiting",
    organizationProfileName:
      pending.naming.status === "named"
        ? personalOrganizationName(pending.naming.name)
        : undefined,
  };
}

interface RegistrationRun {
  readonly fingerprint: string | null;
  readonly identity: object;
}

/**
 * One registration at a time, each tagged with the identity it started
 * under. A run whose identity changed underneath it (a switch away, even one
 * switched back) reports nothing and re-arms registration for the identity
 * now current. A run that settles for its own identity reports its result and
 * re-arms nothing, so a failure is not retried in a loop.
 */
function useRegistrationRuns(signingFingerprint: string | null) {
  const tearleads = useTearleads();
  const [registration, setRegistration] =
    useIdentityScopedStep(signingFingerprint);
  const held = useRef(false);
  const [rearmed, setRearmed] = useState(0);
  const start = useCallback(
    (fingerprint: string | null): RegistrationRun | null => {
      if (held.current) return null;
      held.current = true;
      setRegistration(fingerprint, { status: "running" });
      return { fingerprint, identity: tearleads.identity.snapshot };
    },
    [setRegistration, tearleads],
  );
  const settle = useCallback(
    (run: RegistrationRun, step: AutoProvisioningStep) => {
      held.current = false;
      const current = tearleads.identity.snapshot === run.identity;
      setRegistration(run.fingerprint, current ? step : AUTO_PROVISIONING_IDLE);
      if (!current) setRearmed((count) => count + 1);
    },
    [setRegistration, tearleads],
  );
  return { rearmed, registration, settle, start };
}

function useAutoRegisterIdentity(
  enabled: boolean,
  pending: PendingRegistration,
): AutoProvisioningStep {
  const { features } = useAppHostConfig().profile;
  const { sessionRestoreSettled } = useCryptoSession();
  const { canRegisterCurrentIdentity, registerCurrentIdentity } =
    useRegisterCurrentIdentity();
  const { ensureBootstrapped, status: systemBootstrapStatus } =
    useSystemBootstrap();
  const { logError } = useLog();
  const { signingFingerprint } = useIdentity();
  const { rearmed, registration, settle, start } =
    useRegistrationRuns(signingFingerprint);
  const { awaitingInput, organizationProfileName } =
    pendingRegistration(pending);
  const currentRegistrationRef = useRef({
    canRegisterCurrentIdentity,
    organizationProfileName,
    registerCurrentIdentity,
  });
  currentRegistrationRef.current = {
    canRegisterCurrentIdentity,
    organizationProfileName,
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

        return currentRegistrationRef.current.registerCurrentIdentity({
          organizationProfileName:
            currentRegistrationRef.current.organizationProfileName,
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
          const message = autoRegisterFailureMessage(error);
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
    rearmed,
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
  const { generation, naming, registration } =
    useAutoProvisionIdentity(enabled);
  const { contactNamed, state: accountNaming, submit } = naming;
  const status = useMemo<AutoProvisioningStatus>(
    () => ({
      accountNaming,
      enabled,
      generation,
      registration,
      submitAccountName: submit,
    }),
    [accountNaming, enabled, generation, registration, submit],
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
