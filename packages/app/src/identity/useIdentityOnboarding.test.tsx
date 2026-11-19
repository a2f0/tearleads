import { afterEach, expect, mock, spyOn, test } from "bun:test";
import { createIdentitySeedPhrase } from "@tearleads/crypto";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import {
  cleanupIdentityManagerTestEnvironment,
  createIdentityManagerHostConfig,
  IdentityManagerTestRuntime,
} from "../../test/helpers/identityManagerTestRuntime";
import * as naming from "../providers/identity/accountNamingPersistence";
import * as recovery from "../providers/identity/localIdentitySeedPhraseRestore";
import type { OnboardingForm } from "./identityOnboardingMachine";
import { useIdentityOnboarding } from "./useIdentityOnboarding";

afterEach(cleanupIdentityManagerTestEnvironment);

test.each(["naming-account", "entering-passphrase"] as const)(
  "unmounting during %s drops its late identity notification",
  async (form: OnboardingForm) => {
    const pending = Promise.withResolvers<void>();
    const started = mock(() => pending.promise);
    const notify = mock(() => {});
    using _seal = spyOn(naming, "sealNewAccountName").mockImplementation(
      started,
    );
    const useRestore = recovery.useRestoreSeedPhrase;
    using _restore = spyOn(recovery, "useRestoreSeedPhrase").mockImplementation(
      (input) => {
        const restore = useRestore(input);
        return async (phrase) => {
          await restore(phrase);
          await started();
        };
      },
    );
    const value =
      form === "naming-account" ? "Bob" : createIdentitySeedPhrase();
    function Probe() {
      const onboarding = useIdentityOnboarding(true, notify, notify);
      if (!onboarding) return null;
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
    const hostConfig = createIdentityManagerHostConfig();
    const surface = (mounted: boolean) => (
      <IdentityManagerTestRuntime
        hostConfig={hostConfig}
        onTearleadsReady={() => {}}
      >
        {mounted && <Probe />}
      </IdentityManagerTestRuntime>
    );
    const view = render(surface(true));
    fireEvent.click(await view.findByText("Choose"));
    fireEvent.click(await view.findByText("Submit"));
    await waitFor(() => expect(started).toHaveBeenCalledTimes(1));
    view.rerender(surface(false));
    await act(async () => {
      pending.resolve();
      await pending.promise;
    });
    expect(notify).not.toHaveBeenCalled();
  },
);
