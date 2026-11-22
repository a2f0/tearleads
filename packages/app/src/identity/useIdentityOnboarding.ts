import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useAppHostConfig } from "../providers/host/AppHostConfigProvider";
import { sealNewAccountName } from "../providers/identity/accountNamingPersistence";
import { useIdentity } from "../providers/identity/IdentityProvider";
import { useLocalKeyringLock } from "../providers/local-keyring/LocalKeyringLockProvider";
import { useTearleads } from "../providers/sdk/TearleadsProvider";
import { normalizeAccountName } from "./accountNamingMachine";
import { useOfferIdentityKeychainSave } from "./identityKeychain";
import {
  type IdentityOnboardingState,
  INITIAL_ONBOARDING,
  type OnboardingEvent,
  type OnboardingForm,
  type OnboardingNavigation,
  transitionIdentityOnboarding,
} from "./identityOnboardingMachine";

export interface OnboardingSubmitOptions {
  /** The passphrase came from the password manager, so it is not offered back. */
  readonly fromKeychain?: boolean | undefined;
}

export interface IdentityOnboarding {
  readonly state: IdentityOnboardingState;
  /** Records that the new identity's recovery key is backed up. */
  readonly confirmBackup: () => void;
  readonly navigate: (phase: OnboardingNavigation) => void;
  readonly submit: (
    form: OnboardingForm,
    value: string,
    options?: OnboardingSubmitOptions,
  ) => void;
}

const FAILURE_MESSAGE = {
  "naming-account": "Could not create your identity. Try again.",
  "entering-passphrase":
    "Could not restore your identity. Check your recovery passphrase and try again.",
} as const;

/**
 * An operation in flight, or a created identity awaiting its backup, keeps
 * onboarding on screen after the new key has made it unavailable.
 */
function holdsOnboarding(state: IdentityOnboardingState): boolean {
  return "request" in state || state.status === "confirming-backup";
}

function useOnboardingTransitions() {
  const [state, setState] =
    useState<IdentityOnboardingState>(INITIAL_ONBOARDING);
  // All open surfaces share one request, including submits before React commits.
  const current = useRef<IdentityOnboardingState | null>(state);
  useLayoutEffect(() => {
    current.current = INITIAL_ONBOARDING;
    setState(INITIAL_ONBOARDING);
    return () => {
      current.current = null;
    };
  }, []);
  const isCurrent = useCallback((request: symbol) => {
    const active = current.current;
    return active !== null && "request" in active && active.request === request;
  }, []);
  const send = useCallback((event: OnboardingEvent) => {
    if (!current.current) return;
    const next = transitionIdentityOnboarding(current.current, event);
    if (next !== current.current) {
      current.current = next;
      setState(next);
    }
  }, []);
  const confirmBackup = useCallback(
    () => send({ type: "confirm-backup" }),
    [send],
  );
  return { confirmBackup, isCurrent, send, state };
}

export function useIdentityOnboarding(
  enabled: boolean,
  onNamed: (fingerprint: string, name: string) => void,
  onRecovered: (fingerprint: string) => void,
): IdentityOnboarding | null {
  const sdk = useTearleads();
  const { localIdentityNamespace } = useAppHostConfig();
  const { createLocalKeyring, isLocked } = useLocalKeyringLock();
  const {
    generateKey,
    identityDestroyed,
    identityTransitionInFlight,
    localIdentityRestoreSettled,
    restoreSeedPhrase,
    signingKeyPair,
  } = useIdentity();
  const available =
    enabled &&
    !isLocked &&
    localIdentityRestoreSettled &&
    !identityDestroyed &&
    !identityTransitionInFlight &&
    signingKeyPair === null;
  const { confirmBackup, isCurrent, send, state } = useOnboardingTransitions();
  const offerKeychainSave = useOfferIdentityKeychainSave();
  const navigate = useCallback(
    (phase: OnboardingNavigation) => {
      if (available) send({ type: "navigate", phase });
    },
    [available, send],
  );
  const submit = useCallback<IdentityOnboarding["submit"]>(
    (form, value, options) => {
      const input =
        form === "naming-account" ? normalizeAccountName(value) : value.trim();
      if (!available || !input) return;
      const request = Symbol();
      send({ type: "submit", form, request });
      if (!isCurrent(request)) return;
      const operation =
        form === "entering-passphrase"
          ? restoreSeedPhrase(input).then(() => {
              if (!isCurrent(request)) return;
              const fingerprint = sdk.identity.signingFingerprint;
              if (fingerprint) onRecovered(fingerprint);
            })
          : generateKey({
              beforePersist: async (signingFingerprint) => {
                await sealNewAccountName({
                  createLocalKeyring,
                  name: input,
                  namespace: localIdentityNamespace ?? null,
                  signingFingerprint,
                });
                if (isCurrent(request)) onNamed(signingFingerprint, input);
              },
            }).then((created) => {
              if (!created) throw new Error("Creation failed");
            });
      void operation.then(
        () => {
          // Offered only while this request is still the one on screen, so a
          // superseded or unmounted onboarding never prompts unasked, and never
          // for a passphrase the password manager itself supplied.
          if (isCurrent(request) && !options?.fromKeychain) offerKeychainSave();
          send({ type: "finish", request });
        },
        () => send({ type: "finish", request, error: FAILURE_MESSAGE[form] }),
      );
    },
    [
      available,
      createLocalKeyring,
      generateKey,
      isCurrent,
      localIdentityNamespace,
      offerKeychainSave,
      onNamed,
      onRecovered,
      sdk,
      restoreSeedPhrase,
      send,
    ],
  );
  const visible = available || (holdsOnboarding(state) && enabled && !isLocked);
  return useMemo(
    () => (visible ? { confirmBackup, navigate, state, submit } : null),
    [confirmBackup, navigate, state, submit, visible],
  );
}
