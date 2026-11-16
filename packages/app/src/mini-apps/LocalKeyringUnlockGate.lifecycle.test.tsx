import { afterEach, expect, spyOn, test } from "bun:test";
import {
  fireEvent,
  type RenderResult,
  render,
  waitFor,
} from "@testing-library/react";
import { MOCK_SERVER_RESET_TIMEOUT_MS } from "../../test/helpers/msw/server";
import {
  cleanupPaneTestEnvironment,
  createTestHostConfig,
} from "../../test/helpers/paneTestUtils";
import { AccountBootstrapLoadingPanel } from "../components/identity/AccountBootstrapLoadingPanel";
import type { AppHostConfig } from "../host/AppHostConfig";
import {
  ACCOUNT_NAME_SEAL_FAILED_MESSAGE,
  ACCOUNT_NAMING_IDLE,
  type AccountNamingState,
} from "../identity/accountNamingMachine";
import {
  AUTO_PROVISIONING_IDLE,
  AutoProvisioningStatusContext,
  type AutoProvisioningStep,
  useAutoProvisioningStatus,
} from "../identity/autoProvisioningStatus";
import { AppRuntimeProvider } from "../providers/AppRuntimeProvider";
import { useIdentity } from "../providers/identity/IdentityProvider";
import { useSystemBootstrap } from "../providers/system-bootstrap/SystemBootstrapProvider";
import * as SystemContainers from "../stores/systemContainers";
import { LocalKeyringUnlockGate } from "./LocalKeyringUnlockGate";

afterEach(cleanupPaneTestEnvironment, MOCK_SERVER_RESET_TIMEOUT_MS);

function BootstrapProbe() {
  const { status } = useSystemBootstrap();
  const { registration } = useAutoProvisioningStatus();
  const { signingKeyPair } = useIdentity();
  return (
    <output data-testid="bootstrap">{`${status}:${registration.status}:${signingKeyPair !== null}`}</output>
  );
}

test("stalled system-folder derivation does not hide local mini-app content", async () => {
  const derive = spyOn(
    SystemContainers,
    "deriveUserSystemContainers",
  ).mockRejectedValue(new Error("slot derivation unavailable"));
  try {
    const view = render(
      <AppRuntimeProvider
        hostConfig={createTestHostConfig({ autoProvisionIdentity: true })}
      >
        <BootstrapProbe />
        <LocalKeyringUnlockGate appName="Explorer">
          <p>Local workspace</p>
        </LocalKeyringUnlockGate>
      </AppRuntimeProvider>,
    );
    await waitFor(() => {
      expect(derive).toHaveBeenCalled();
      expect(view.getByTestId("bootstrap").textContent).toBe(
        "waiting:idle:true",
      );
    });
    expect(view.getByText("Local workspace")).toBeTruthy();
    view.unmount();
  } finally {
    derive.mockRestore();
  }
});

test("a provisioning retry preserves already-mounted mini-app content", async () => {
  const hostConfig = createTestHostConfig({ autoProvisionIdentity: true });
  const failed = { status: "failed", message: "Try again" } as const;
  const surface = (registration: AutoProvisioningStep) => (
    <AppRuntimeProvider hostConfig={hostConfig} autoProvisionEnabled={false}>
      <AutoProvisioningStatusContext.Provider
        value={{
          accountNaming: ACCOUNT_NAMING_IDLE,
          accountNamingSettled: true,
          enabled: true,
          generation: failed,
          registration,
          submitAccountName: () => {},
        }}
      >
        <LocalKeyringUnlockGate appName="Notes">
          <textarea aria-label="Draft" defaultValue="" />
        </LocalKeyringUnlockGate>
      </AutoProvisioningStatusContext.Provider>
    </AppRuntimeProvider>
  );
  const view = render(surface(failed));
  fireEvent.click(
    await view.findByRole("button", { name: "Generate Key Pair" }),
  );
  const draft = await view.findByRole("textbox", { name: "Draft" });
  fireEvent.change(draft, { target: { value: "Keep this draft" } });

  view.rerender(surface({ status: "running" }));
  expect(view.getByRole("textbox", { name: "Draft" })).toBe(draft);
  expect((draft as HTMLTextAreaElement).value).toBe("Keep this draft");
  expect(
    view.queryByRole("heading", { name: "Creating your account" }),
  ).toBeNull();
  view.unmount();
});

test("usable local keys stay accessible during idle, running, and failed registration", async () => {
  const hostConfig = createTestHostConfig({ autoProvisionIdentity: true });
  const failed = { status: "failed", message: "Try again" } as const;
  const surface = (registration: AutoProvisioningStep) => (
    <AppRuntimeProvider hostConfig={hostConfig} autoProvisionEnabled={false}>
      <AutoProvisioningStatusContext.Provider
        value={{
          accountNaming: ACCOUNT_NAMING_IDLE,
          accountNamingSettled: true,
          enabled: true,
          generation: failed,
          registration,
          submitAccountName: () => {},
        }}
      >
        <LocalKeyringUnlockGate appName="Explorer">
          <p>Local workspace</p>
          <AccountBootstrapLoadingPanel title="Loading your workspace" />
        </LocalKeyringUnlockGate>
      </AutoProvisioningStatusContext.Provider>
    </AppRuntimeProvider>
  );
  const view = render(surface({ status: "running" }));
  fireEvent.click(
    await view.findByRole("button", { name: "Generate Key Pair" }),
  );
  expect(await view.findByText("Local workspace")).toBeTruthy();
  expect(
    view.getByRole("heading", { name: "Creating your account" }),
  ).toBeTruthy();
  for (const registration of [
    { status: "idle" } as const,
    failed,
    { status: "running" } as const,
  ]) {
    view.rerender(surface(registration));
    expect(view.getByText("Local workspace")).toBeTruthy();
    expect(
      view.getByRole("heading", {
        name:
          registration.status === "failed"
            ? "Loading your workspace"
            : "Creating your account",
      }),
    ).toBeTruthy();
  }
  view.unmount();
});

function GenerateKeyProbe() {
  const { generateKey } = useIdentity();
  return (
    <button onClick={() => void generateKey()} type="button">
      Probe key
    </button>
  );
}

function namingSurface(
  hostConfig: AppHostConfig,
  accountNamingSettled: boolean,
  accountNaming: AccountNamingState,
) {
  return (
    <AppRuntimeProvider hostConfig={hostConfig} autoProvisionEnabled={false}>
      <AutoProvisioningStatusContext.Provider
        value={{
          accountNaming,
          accountNamingSettled,
          enabled: true,
          generation: AUTO_PROVISIONING_IDLE,
          registration: AUTO_PROVISIONING_IDLE,
          submitAccountName: () => {},
        }}
      >
        <BootstrapProbe />
        <GenerateKeyProbe />
        <LocalKeyringUnlockGate appName="Notes">
          <textarea aria-label="Draft" defaultValue="" />
        </LocalKeyringUnlockGate>
      </AutoProvisioningStatusContext.Provider>
    </AppRuntimeProvider>
  );
}

/** Installs a key through Identity, outside the autopilot. */
async function probeKey(view: RenderResult): Promise<void> {
  fireEvent.click(await view.findByRole("button", { name: "Probe key" }));
  await waitFor(() => {
    expect(view.getByTestId("bootstrap").textContent).toMatch(/:true$/u);
  });
}

test("a restored identity's apps wait until its sealed naming is read back", async () => {
  const hostConfig = createTestHostConfig({ autoProvisionIdentity: true });
  // The key is in place, but its sealed naming is still being read.
  const view = render(namingSurface(hostConfig, false, ACCOUNT_NAMING_IDLE));
  await probeKey(view);
  expect(view.queryByRole("textbox", { name: "Draft" })).toBeNull();

  // It owed a name: the prompt takes over, and no app was opened under it.
  view.rerender(
    namingSurface(hostConfig, true, {
      fingerprint: "restored",
      status: "awaiting",
    }),
  );
  expect(
    await view.findByRole("textbox", { name: "What should we call you?" }),
  ).toBeTruthy();
  expect(view.queryByRole("textbox", { name: "Draft" })).toBeNull();
  view.unmount();
});

test("an answered name holds the apps until it is stored", async () => {
  const hostConfig = createTestHostConfig({ autoProvisionIdentity: true });
  const named = {
    contactNamed: false,
    fingerprint: "new",
    name: "Bob",
    sealed: false,
    status: "named",
  } as const;
  const view = render(namingSurface(hostConfig, true, named));
  await probeKey(view);
  expect(view.queryByRole("textbox", { name: "Draft" })).toBeNull();

  // The save failed: the prompt is back, with nothing opened under it to lose.
  view.rerender(
    namingSurface(hostConfig, true, {
      error: ACCOUNT_NAME_SEAL_FAILED_MESSAGE,
      fingerprint: "new",
      status: "awaiting",
    }),
  );
  expect(await view.findByText(ACCOUNT_NAME_SEAL_FAILED_MESSAGE)).toBeTruthy();
  expect(view.queryByRole("textbox", { name: "Draft" })).toBeNull();

  // Stored this time: the apps open.
  view.rerender(namingSurface(hostConfig, true, { ...named, sealed: true }));
  expect(await view.findByRole("textbox", { name: "Draft" })).toBeTruthy();
  view.unmount();
});
