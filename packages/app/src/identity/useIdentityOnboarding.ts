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

export interface IdentityOnboarding {
  readonly state: IdentityOnboardingState;
  readonly navigate: (phase: OnboardingNavigation) => void;
  readonly submit: (form: OnboardingForm, value: string) => void;
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
  return { state, send, isCurrent };
}

const ONBOARDING_FAILURE: Record<OnboardingForm, string> = {
  "entering-passphrase":
    "Could not restore your identity. Check your recovery passphrase and try again.",
  "naming-account": "Could not create your identity. Try again.",
};

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
  const { state, send, isCurrent } = useOnboardingTransitions();
  const offerKeychainSave = useOfferIdentityKeychainSave();
  const navigate = useCallback(
    (phase: OnboardingNavigation) => {
      if (available) send({ type: "navigate", phase });
    },
    [available, send],
  );
  const submit = useCallback(
    (form: OnboardingForm, value: string) => {
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
          // superseded or unmounted onboarding never prompts unasked.
          if (isCurrent(request)) offerKeychainSave();
          send({ type: "finish", request });
        },
        () =>
          send({ type: "finish", request, error: ONBOARDING_FAILURE[form] }),
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
  const visible = available || ("request" in state && enabled && !isLocked);
  return useMemo(
    () => (visible ? { navigate, state, submit } : null),
    [navigate, state, submit, visible],
  );
}
