import { afterEach, expect, mock, spyOn, test } from "bun:test";
import type { Tearleads } from "@tearleads/client-sdk";
import { createIdentitySeedPhrase } from "@tearleads/crypto";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import {
  cleanupIdentityManagerTestEnvironment,
  createIdentityManagerHostConfig,
  IdentityManagerTestRuntime,
} from "../../test/helpers/identityManagerTestRuntime";
import type {
  PasswordKeychainEntry,
  PasswordKeychainSaveOutcome,
} from "../host/PasswordKeychain";
import * as naming from "../providers/identity/accountNamingPersistence";
import { useLogEntries } from "../providers/logging/LogProvider";
import {
  identityKeychainEntry,
  KEYCHAIN_SAVE_STATUS,
} from "./identityKeychain";
import type { OnboardingForm } from "./identityOnboardingMachine";
import { useIdentityOnboarding } from "./useIdentityOnboarding";

afterEach(cleanupIdentityManagerTestEnvironment);

function renderOnboarding(
  form: OnboardingForm,
  value: string,
  outcome: PasswordKeychainSaveOutcome = "offered",
) {
  const save = mock(async (_entry: PasswordKeychainEntry) => outcome);
  const keychain = { pick: async () => null, save };
  const sdkRef: { current: Tearleads | null } = { current: null };
  const logRef: { current: ReadonlyArray<{ level: string; message: string }> } =
    { current: [] };
  function Probe() {
    logRef.current = useLogEntries();
    const onboarding = useIdentityOnboarding(
      true,
      () => {},
      () => {},
    );
    if (!onboarding) return <p>Onboarded</p>;
    return onboarding.state.status === "choosing-identity" ? (
      <button type="button" onClick={() => onboarding.navigate(form)}>
        Choose
      </button>
    ) : (
      <button type="button" onClick={() => onboarding.submit(form, value)}>
        Submit
      </button>
    );
  }
  const hostConfig = createIdentityManagerHostConfig().withOverrides({
    createPasswordKeychain: () => keychain,
  });
  const surface = (mounted: boolean) => (
    <IdentityManagerTestRuntime
      hostConfig={hostConfig}
      onTearleadsReady={(sdk) => {
        sdkRef.current = sdk;
      }}
    >
      {mounted && <Probe />}
    </IdentityManagerTestRuntime>
  );
  const view = render(surface(true));
  return { logRef, save, sdkRef, surface, view };
}

test("creating an identity offers its new recovery passphrase to the keychain", async () => {
  const { save, sdkRef, view } = renderOnboarding("naming-account", "Bob");
  fireEvent.click(await view.findByText("Choose"));
  fireEvent.click(await view.findByText("Submit"));
  await view.findByText("Onboarded");
  const { seedPhrase, signingFingerprint } = sdkRef.current?.identity ?? {};
  if (!seedPhrase || !signingFingerprint)
    throw new Error("Expected an identity");
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  expect(save).toHaveBeenCalledWith(
    identityKeychainEntry(signingFingerprint, seedPhrase),
  );
});

test("restoring an identity offers the passphrase it was restored from", async () => {
  const passphrase = createIdentitySeedPhrase();
  const { save, sdkRef, view } = renderOnboarding(
    "entering-passphrase",
    passphrase,
  );
  fireEvent.click(await view.findByText("Choose"));
  fireEvent.click(await view.findByText("Submit"));
  await view.findByText("Onboarded");
  const signingFingerprint = sdkRef.current?.identity.signingFingerprint;
  if (!signingFingerprint) throw new Error("Expected an identity");
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  expect(save).toHaveBeenCalledWith(
    identityKeychainEntry(signingFingerprint, passphrase),
  );
});

test("an onboarding unmounted mid-creation never prompts", async () => {
  const pending = Promise.withResolvers<void>();
  using _seal = spyOn(naming, "sealNewAccountName").mockImplementation(
    () => pending.promise,
  );
  const { save, surface, view } = renderOnboarding("naming-account", "Bob");
  fireEvent.click(await view.findByText("Choose"));
  fireEvent.click(await view.findByText("Submit"));
  await waitFor(() => expect(naming.sealNewAccountName).toHaveBeenCalled());
  view.rerender(surface(false));
  await act(async () => {
    pending.resolve();
    await pending.promise;
  });
  expect(save).not.toHaveBeenCalled();
});

test("a device with no password manager is logged, not reported as an error", async () => {
  const { logRef, save, view } = renderOnboarding(
    "naming-account",
    "Bob",
    "unavailable",
  );
  fireEvent.click(await view.findByText("Choose"));
  fireEvent.click(await view.findByText("Submit"));
  await view.findByText("Onboarded");
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  await waitFor(() =>
    expect(logRef.current.map((entry) => entry.message)).toContain(
      KEYCHAIN_SAVE_STATUS.unavailable,
    ),
  );
  expect(logRef.current.filter((entry) => entry.level === "error")).toEqual([]);
});
