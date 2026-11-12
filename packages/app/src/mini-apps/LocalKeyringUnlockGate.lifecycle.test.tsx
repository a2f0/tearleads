import { afterEach, expect, test } from "bun:test";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { MOCK_SERVER_RESET_TIMEOUT_MS } from "../../test/helpers/msw/server";
import {
  cleanupPaneTestEnvironment,
  createTestHostConfig,
} from "../../test/helpers/paneTestUtils";
import {
  AutoProvisioningStatusContext,
  type AutoProvisioningStep,
} from "../identity/autoProvisioningStatus";
import { AppRuntimeProvider } from "../providers/AppRuntimeProvider";
import { LocalKeyringUnlockGate } from "./LocalKeyringUnlockGate";

afterEach(cleanupPaneTestEnvironment, MOCK_SERVER_RESET_TIMEOUT_MS);

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

test("a failed registration releases an initially provisioning mini-app", async () => {
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
  await waitFor(() => {
    expect(
      view.getByRole("heading", { name: "Creating your account" }),
    ).toBeTruthy();
  });
  expect(view.queryByText("Local workspace")).toBeNull();
  view.rerender(surface(failed));
  expect(await view.findByText("Local workspace")).toBeTruthy();
  view.unmount();
});
