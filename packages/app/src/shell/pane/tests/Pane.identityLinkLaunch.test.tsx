import { afterEach, expect, test } from "bun:test";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { mockIdentityLink } from "../../../../test/helpers/mockIdentityLink";
import {
  cleanupPaneTestEnvironment,
  createTestHostConfig,
} from "../../../../test/helpers/paneTestUtils";
import { SystemMonitorDeveloperModeProvider } from "../../../mini-apps/system-monitor/systemMonitorDeveloperMode";
import { DualPaneProvider, PaneSideProvider } from "../dual-pane";
import { PaneProvider } from "../runtime/PaneProvider";
import { Pane } from "../shell/Pane";

afterEach(async () => {
  await cleanupPaneTestEnvironment();
  window.history.replaceState(null, "", "/");
});

for (const mode of ["routed", "windowed"] as const) {
  test(`identity permalink survives first-use provisioning in ${mode} mode`, async () => {
    const peerId = "11111111-1111-4111-8111-111111111111";
    const link = await mockIdentityLink(peerId);
    const browser = window as typeof window & {
      happyDOM: { setURL: (url: string) => void };
    };
    browser.happyDOM.setURL(link);
    window.history.replaceState(null, "", new URL(link).pathname);
    const view = render(
      <SystemMonitorDeveloperModeProvider>
        <DualPaneProvider>
          <PaneSideProvider side="left">
            <PaneProvider
              hostConfig={createTestHostConfig({ autoProvisionIdentity: true })}
            >
              <Pane
                className="pane"
                active
                navigationMode={mode}
                routedVisible
              />
            </PaneProvider>
          </PaneSideProvider>
        </DualPaneProvider>
      </SystemMonitorDeveloperModeProvider>,
    );
    await view.findByRole(
      "textbox",
      { name: "Identity link" },
      { timeout: 15_000 },
    );
    const currentInput = () => {
      const input = view.getByRole("textbox", { name: "Identity link" });
      if (!(input instanceof HTMLInputElement))
        throw new Error("Expected identity link input");
      return input;
    };
    await waitFor(() =>
      expect(new URL(currentInput().value).pathname).toBe(
        new URL(link).pathname,
      ),
    );
    await waitFor(
      () => {
        const submit = view.getByRole("button", { name: "Verify and Add" });
        expect(submit.hasAttribute("disabled")).toBe(false);
      },
      { timeout: 15_000 },
    );
    expect(currentInput().value).toContain(new URL(link).pathname);
    fireEvent.click(view.getByRole("button", { name: "Verify and Add" }));
    await view.findByText(peerId, {}, { timeout: 15_000 });
  }, 30_000);
}
