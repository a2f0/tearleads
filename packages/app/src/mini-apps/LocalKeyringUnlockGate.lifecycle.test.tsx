import { afterEach, expect, spyOn, test } from "bun:test";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { MOCK_SERVER_RESET_TIMEOUT_MS } from "../../test/helpers/msw/server";
import {
  cleanupPaneTestEnvironment,
  createTestHostConfig,
} from "../../test/helpers/paneTestUtils";
import {
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
        value={{ enabled: true, generation: failed, registration }}
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
        value={{ enabled: true, generation: failed, registration }}
      >
        <LocalKeyringUnlockGate appName="Explorer">
          <p>Local workspace</p>
        </LocalKeyringUnlockGate>
      </AutoProvisioningStatusContext.Provider>
    </AppRuntimeProvider>
  );
  const view = render(surface({ status: "running" }));
  fireEvent.click(
    await view.findByRole("button", { name: "Generate Key Pair" }),
  );
  expect(await view.findByText("Local workspace")).toBeTruthy();
  for (const registration of [
    { status: "idle" } as const,
    failed,
    { status: "running" } as const,
  ]) {
    view.rerender(surface(registration));
    expect(view.getByText("Local workspace")).toBeTruthy();
  }
  view.unmount();
});
