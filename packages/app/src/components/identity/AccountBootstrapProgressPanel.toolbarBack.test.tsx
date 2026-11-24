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
          confirmBackup: () => {},
          navigate: (phase) =>
            setState((current) =>
              transitionIdentityOnboarding(current, {
                type: "navigate",
                phase,
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
