import { afterEach, expect, test } from "bun:test";
import { WindowMenuProvider, WindowToolBar } from "@tearleads/windowing";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { useState } from "react";
import { createAppHostConfig } from "../../host/AppHostConfig";
import { accountBootstrapCopy } from "../../identity/accountBootstrapPhase";
import { ACCOUNT_NAMING_IDLE } from "../../identity/accountNamingMachine";
import {
  AUTO_PROVISIONING_IDLE,
  AutoProvisioningStatusContext,
} from "../../identity/autoProvisioningStatus";
import {
  type IdentityOnboardingState,
  INITIAL_ONBOARDING,
  transitionIdentityOnboarding,
} from "../../identity/identityOnboardingMachine";
import { AppHostConfigProvider } from "../../providers/host/AppHostConfigProvider";
import { AccountBootstrapProgressPanel } from "./AccountBootstrapProgressPanel";

afterEach(() => {
  cleanup();
  globalThis.localStorage.clear();
});

const hostConfig = createAppHostConfig({
  apiBaseUrl: "http://localhost:3001",
  wsUrl: "ws://localhost:3001/events",
});

/** The onboarding panel under a window toolbar, driven by the real machine. */
function OnboardingWindow() {
  const [state, setState] =
    useState<IdentityOnboardingState>(INITIAL_ONBOARDING);
  const progress = accountBootstrapCopy(state.status);
  if (!progress) throw new Error("Expected onboarding copy");
  return (
    <AutoProvisioningStatusContext.Provider
      value={{
        accountNaming: ACCOUNT_NAMING_IDLE,
        accountNamingSettled: true,
        enabled: true,
        generation: AUTO_PROVISIONING_IDLE,
        onboarding: {
          agreeToTerms: () =>
            setState((current) =>
              transitionIdentityOnboarding(current, { type: "terms-agreed" }),
            ),
          confirmBackup: () => {},
          // As before agreement: creating asks for the terms first.
          navigate: (phase) =>
            setState((current) =>
              transitionIdentityOnboarding(current, {
                type: "navigate",
                phase:
                  phase === "naming-account" &&
                  current.status === "choosing-identity"
                    ? "accepting-terms"
                    : phase,
              }),
            ),
          state,
          submit: () => {},
        },
        registration: AUTO_PROVISIONING_IDLE,
        submitAccountName: () => {},
      }}
    >
      <WindowMenuProvider>
        <WindowToolBar />
        <AccountBootstrapProgressPanel progress={progress} />
      </WindowMenuProvider>
    </AutoProvisioningStatusContext.Provider>
  );
}

function renderOnboardingWindow() {
  const view = render(
    <AppHostConfigProvider value={hostConfig}>
      <OnboardingWindow />
    </AppHostConfigProvider>,
  );
  const toolbar = () => view.getByRole("toolbar", { name: "Toolbar" });
  return { toolbar, view };
}

test("creating an identity agrees to the terms before naming it", async () => {
  const { toolbar, view } = renderOnboardingWindow();
  fireEvent.click(view.getByRole("button", { name: "Create new identity" }));
  await view.findByRole("heading", { name: "Review our terms" });
  view.getByRole("tab", { name: "Terms of Service", selected: true });
  view.getByRole("heading", { name: "1. The agreement" });
  fireEvent.click(view.getByRole("tab", { name: "Privacy Policy" }));
  view.getByRole("tab", { name: "Privacy Policy", selected: true });
  view.getByRole("heading", { name: "1. Who we are and what this covers" });
  const proceed = view.getByRole("button", { name: "Continue" });
  expect(proceed).toHaveProperty("disabled", true);
  fireEvent.click(
    view.getByRole("checkbox", {
      name: "I agree to the Terms of Service and Privacy Policy",
    }),
  );
  fireEvent.click(proceed);
  await view.findByRole("heading", { name: "What should we call you?" });
  // Back from naming returns to the choice, not to the agreement.
  fireEvent.click(
    await within(toolbar()).findByRole("button", { name: "Back" }),
  );
  await view.findByRole("button", { name: "Restore identity" });
});

for (const choice of ["Restore identity", "Create new identity"]) {
  test(`the toolbar Back leaves the form ${choice} opens`, async () => {
    const { toolbar, view } = renderOnboardingWindow();
    // The choice is the first phase: there is nothing for Back to leave.
    expect(view.queryByRole("toolbar", { name: "Toolbar" })).toBeNull();

    fireEvent.click(view.getByRole("button", { name: choice }));
    fireEvent.click(
      await within(toolbar()).findByRole("button", { name: "Back" }),
    );

    await view.findByRole("button", { name: "Restore identity" });
    expect(within(toolbar()).queryByRole("button", { name: "Back" })).toBe(
      null,
    );
  });
}
