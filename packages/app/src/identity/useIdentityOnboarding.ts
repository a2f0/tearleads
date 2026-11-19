import { useCallback, useMemo, useRef, useState } from "react";
import { useAppHostConfig } from "../providers/host/AppHostConfigProvider";
import { sealNewAccountName } from "../providers/identity/accountNamingPersistence";
import { useIdentity } from "../providers/identity/IdentityProvider";
import { useLocalKeyringLock } from "../providers/local-keyring/LocalKeyringLockProvider";
import { useTearleads } from "../providers/sdk/TearleadsProvider";
import { normalizeAccountName } from "./accountNamingMachine";
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
  const current = useRef(state);
  const send = useCallback((event: OnboardingEvent) => {
    current.current = transitionIdentityOnboarding(current.current, event);
    setState(current.current);
    return current.current;
  }, []);
  return { state, send };
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
  const { state, send } = useOnboardingTransitions();
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
      const next = send({ type: "submit", form, request });
      if (!("request" in next) || next.request !== request) return;
      const operation =
        form === "entering-passphrase"
          ? restoreSeedPhrase(input).then(() => {
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
                onNamed(signingFingerprint, input);
              },
            }).then((created) => {
              if (!created) throw new Error("Creation failed");
            });
      void operation.then(
        () => send({ type: "finish", request }),
        () =>
          send({
            type: "finish",
            request,
            error:
              form === "naming-account"
                ? "Could not create your identity. Try again."
                : "Could not restore your identity. Check your recovery passphrase and try again.",
          }),
      );
    },
    [
      available,
      createLocalKeyring,
      generateKey,
      localIdentityNamespace,
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
