import { afterEach, expect, mock, test } from "bun:test";
import { createIdentitySeedPhrase } from "@tearleads/crypto";
import { fireEvent, render } from "@testing-library/react";
import {
  cleanupIdentityManagerTestEnvironment,
  createIdentityManagerHostConfig,
  IdentityManagerTestRuntime,
} from "../../test/helpers/identityManagerTestRuntime";
import type { PasswordKeychainEntry } from "../host/PasswordKeychain";
import type { OnboardingForm } from "./identityOnboardingMachine";
import { useIdentityOnboarding } from "./useIdentityOnboarding";

afterEach(cleanupIdentityManagerTestEnvironment);

/**
 * Onboarding on a host with a password manager. Saving the recovery key there
 * is only ever the user's explicit, acknowledged choice (Save to Password
 * Manager), never a prompt onboarding raises on its own.
 */
function renderOnboarding(form: OnboardingForm, value: string) {
  const save = mock(async (_entry: PasswordKeychainEntry) => "saved" as const);
  function Probe() {
    const onboarding = useIdentityOnboarding(
      true,
      () => {},
      () => {},
    );
    if (!onboarding) return <p>Onboarded</p>;
    // A created identity waits on its backup agreement; a restore does not.
    if (onboarding.state.status === "confirming-backup")
      return <p>Backing up</p>;
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
    createPasswordKeychain: () => ({ pick: async () => null, save }),
  });
  const view = render(
    <IdentityManagerTestRuntime
      hostConfig={hostConfig}
      onTearleadsReady={() => {}}
    >
      <Probe />
    </IdentityManagerTestRuntime>,
  );
  return { save, view };
}

// Each wait below ends on the state onboarding enters when its operation
// finishes, which is where an unasked offer would have been made.

test("creating an identity never offers its recovery key unasked", async () => {
  const { save, view } = renderOnboarding("naming-account", "Bob");
  fireEvent.click(await view.findByText("Choose"));
  fireEvent.click(await view.findByText("Submit"));
  await view.findByText("Backing up");
  expect(save).not.toHaveBeenCalled();
});

test("restoring an identity never offers its passphrase unasked", async () => {
  const { save, view } = renderOnboarding(
    "entering-passphrase",
    createIdentitySeedPhrase(),
  );
  fireEvent.click(await view.findByText("Choose"));
  fireEvent.click(await view.findByText("Submit"));
  await view.findByText("Onboarded");
  expect(save).not.toHaveBeenCalled();
});
