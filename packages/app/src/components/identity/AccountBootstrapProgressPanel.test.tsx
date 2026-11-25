import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { createAppHostConfig } from "../../host/AppHostConfig";
import { accountBootstrapCopy } from "../../identity/accountBootstrapPhase";
import { ACCOUNT_NAMING_IDLE } from "../../identity/accountNamingMachine";
import {
  AUTO_PROVISIONING_IDLE,
  AutoProvisioningStatusContext,
} from "../../identity/autoProvisioningStatus";
import { AppHostConfigProvider } from "../../providers/host/AppHostConfigProvider";
import { AccountBootstrapProgressPanel } from "./AccountBootstrapProgressPanel";

afterEach(() => {
  cleanup();
  globalThis.localStorage.clear();
});

test("onboarding offers the telemetry opt-in, off, beside creating or restoring", () => {
  const hostConfig = createAppHostConfig({
    apiBaseUrl: "http://localhost:3001",
    wsUrl: "ws://localhost:3001/events",
  });
  const progress = accountBootstrapCopy("choosing-identity");
  if (!progress) throw new Error("Expected onboarding copy");
  const view = render(
    <AppHostConfigProvider value={hostConfig}>
      <AutoProvisioningStatusContext.Provider
        value={{
          accountNaming: ACCOUNT_NAMING_IDLE,
          accountNamingSettled: true,
          enabled: true,
          generation: AUTO_PROVISIONING_IDLE,
          onboarding: {
            confirmBackup: () => {},
            navigate: () => {},
            state: { status: "choosing-identity" },
            submit: () => {},
          },
          registration: AUTO_PROVISIONING_IDLE,
          submitAccountName: () => {},
        }}
      >
        <AccountBootstrapProgressPanel progress={progress} />
      </AutoProvisioningStatusContext.Provider>
    </AppHostConfigProvider>,
  );

  view.getByRole("button", { name: "Create new identity" });
  view.getByRole("button", { name: "Restore identity" });
  const telemetry = view.getByRole("switch", {
    name: "Share anonymous telemetry",
  });
  expect(telemetry).toHaveProperty("checked", false);
  // Onboarding shows the switch and its label only; Settings explains it.
  expect(telemetry.hasAttribute("aria-describedby")).toBe(false);
  expect(view.queryByText(/Sends error reports/)).toBeNull();
  fireEvent.click(telemetry);
  expect(hostConfig.telemetryConsent.enabled()).toBe(true);
});
