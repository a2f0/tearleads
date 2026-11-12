import { afterEach, beforeEach, expect, test } from "bun:test";
import { act, render, waitFor } from "@testing-library/react";
import {
  MOCK_SERVER_RESET_TIMEOUT_MS,
  useTestApiAppHandlers,
} from "../../test/helpers/msw/server";
import {
  cleanupPaneTestEnvironment,
  createDelayedLoadLocalKeyringFactory,
  createSharedMemoryLocalKeyringFactory,
  createTestHostConfig,
} from "../../test/helpers/paneTestUtils";
import { useCryptoSession } from "../providers/crypto/CryptoSessionProvider";
import { DeveloperModeProvider } from "../providers/developer-mode/DeveloperModeProvider";
import { DualPaneProvider, PaneSideProvider } from "../shell/pane/dual-pane";
import { PaneProvider } from "../shell/pane/runtime/PaneProvider";
import { Pane } from "../shell/pane/shell/Pane";

const browser = window as typeof window & {
  happyDOM: { setURL: (url: string) => void };
};
let previousUrl = window.location.href;

beforeEach(() => {
  previousUrl = window.location.href;
  useTestApiAppHandlers();
});

afterEach(async () => {
  await cleanupPaneTestEnvironment();
  browser.happyDOM.setURL(previousUrl);
  window.history.replaceState(null, "", previousUrl);
}, MOCK_SERVER_RESET_TIMEOUT_MS);

function SessionProbe() {
  const { isAuthenticated } = useCryptoSession();
  return <output data-testid="session">{String(isAuthenticated)}</output>;
}

for (const appId of [
  "org-manager",
  "explorer",
  "contacts",
  "notes",
  "organizations",
  "root",
]) {
  test(`${appId} boots directly into provisioning progress without a local-key prompt`, async () => {
    browser.happyDOM.setURL(`http://localhost/app/${appId}`);
    window.history.replaceState(null, "", `/app/${appId}`);
    const keyring = createDelayedLoadLocalKeyringFactory(
      createSharedMemoryLocalKeyringFactory(),
    );
    const view = render(
      <DeveloperModeProvider>
        <DualPaneProvider>
          <PaneSideProvider side="left">
            <PaneProvider
              hostConfig={createTestHostConfig({
                autoProvisionIdentity: true,
                createLocalKeyring: keyring.createLocalKeyring,
                localIdentityNamespace: `bootstrap-${appId}`,
              })}
            >
              <SessionProbe />
              <Pane
                className="pane"
                active
                navigationMode="routed"
                routedVisible
              />
            </PaneProvider>
          </PaneSideProvider>
        </DualPaneProvider>
      </DeveloperModeProvider>,
    );
    const seen = new Set<string>();
    const record = () => {
      for (const heading of view.container.querySelectorAll("h2")) {
        seen.add(heading.textContent ?? "");
      }
    };
    const observer = new MutationObserver(record);
    observer.observe(view.container, {
      characterData: true,
      childList: true,
      subtree: true,
    });
    record();

    try {
      expect(
        view.getByRole("heading", { name: "Restoring your session" }),
      ).toBeTruthy();
      expect(
        view.container.querySelector(".mini-app-state-panel-spinner"),
      ).not.toBeNull();
      await act(async () => keyring.releaseLoadSession());
      await waitFor(
        () => {
          expect(view.getByTestId("session").textContent).toBe("true");
        },
        { timeout: 30_000 },
      );
      record();
      expect(seen.has("Local keys required")).toBe(false);
      expect(seen.has("Loading local keys")).toBe(false);
      expect(seen.has("Creating your identity")).toBe(true);
      expect(seen.has("Creating your account")).toBe(true);
      expect(
        view.queryByRole("heading", { name: "Creating your account" }),
      ).toBeNull();
    } finally {
      keyring.releaseLoadSession();
      observer.disconnect();
      view.unmount();
    }
  }, 45_000);
}
