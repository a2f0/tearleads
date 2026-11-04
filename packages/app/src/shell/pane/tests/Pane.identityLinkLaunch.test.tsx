import { afterEach, beforeEach, expect, test } from "bun:test";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { mockIdentityLink } from "../../../../test/helpers/mockIdentityLink";
import { MOCK_SERVER_RESET_TIMEOUT_MS } from "../../../../test/helpers/mswServer";
import {
  cleanupPaneTestEnvironment,
  createTestHostConfig,
} from "../../../../test/helpers/paneTestUtils";
import { DeveloperModeProvider } from "../../../providers/developer-mode/DeveloperModeProvider";
import { DualPaneProvider, PaneSideProvider } from "../dual-pane";
import { PaneProvider } from "../runtime/PaneProvider";
import { Pane } from "../shell/Pane";

const browser = window as typeof window & {
  happyDOM: { setURL: (url: string) => void };
};
let previousUrl = window.location.href;
beforeEach(() => {
  previousUrl = window.location.href;
});

afterEach(async () => {
  await cleanupPaneTestEnvironment();
  browser.happyDOM.setURL(previousUrl);
  window.history.replaceState(null, "", previousUrl);
}, MOCK_SERVER_RESET_TIMEOUT_MS);

for (const [mode, native] of [
  ["routed", false],
  ["windowed", false],
  ["windowed", true],
] as const) {
  test(`identity permalink survives first-use provisioning in ${mode} mode (native: ${native})`, async () => {
    const peerId = "11111111-1111-4111-8111-111111111111";
    const link = await mockIdentityLink(peerId);
    browser.happyDOM.setURL(
      native ? `views://main${new URL(link).pathname}` : link,
    );
    window.history.replaceState(null, "", new URL(link).pathname);
    expect(window.location.pathname).toBe(new URL(link).pathname);
    const view = render(
      <DeveloperModeProvider>
        <DualPaneProvider>
          <PaneSideProvider side="left">
            <PaneProvider
              hostConfig={{
                ...createTestHostConfig({ autoProvisionIdentity: true }),
                identityLinkWebUrl: native
                  ? undefined
                  : "http://localhost:3000",
              }}
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
      </DeveloperModeProvider>,
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
    // The verified, still unnamed contact opens; its user ID stays hidden.
    await view.findByRole(
      "heading",
      { name: "Untitled contact" },
      { timeout: 15_000 },
    );
    expect(view.queryByText(peerId)).toBeNull();
  }, 30_000);
}
