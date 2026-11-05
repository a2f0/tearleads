import { afterEach, expect, test } from "bun:test";
import { fireEvent, waitFor } from "@testing-library/react";
import {
  MOCK_SERVER_RESET_TIMEOUT_MS,
  useTestApiAppHandlers,
} from "../../../../test/helpers/mswServer";
import {
  cleanupPaneTestEnvironment,
  clickPaneAppMenuItem,
  createTestHostConfig,
  PANE_ASYNC_TEST_TIMEOUT_MS,
  PANE_LONG_ASYNC_TEST_TIMEOUT_MS,
  renderPane,
  waitForPaneRuntimeToSettle,
} from "../../../../test/helpers/paneTestUtils";

afterEach(cleanupPaneTestEnvironment, MOCK_SERVER_RESET_TIMEOUT_MS);

const PROGRESS_TITLES = [
  "Restoring your session",
  "Creating your identity",
  "Creating your account",
  "Signing you in",
];

test(
  "identity manager shows account setup as one panel, not inline status lines",
  async () => {
    useTestApiAppHandlers();
    const view = renderPane({
      hostConfig: createTestHostConfig({ autoProvisionIdentity: true }),
    });
    const panelTitles = new Set<string>();
    const inlineStatuses = new Set<string>();
    const record = () => {
      for (const heading of view.container.querySelectorAll(
        ".identity-manager .mini-app-state-panel-title",
      )) {
        panelTitles.add(heading.textContent ?? "");
      }
      for (const status of view.container.querySelectorAll(
        ".identity-manager .mini-app-status--busy",
      )) {
        inlineStatuses.add(status.textContent ?? "");
      }
    };
    const observer = new MutationObserver(record);
    observer.observe(view.container, {
      characterData: true,
      childList: true,
      subtree: true,
    });

    // The pane menu lists Identity Manager once a key pair exists.
    await waitFor(
      () => {
        fireEvent.contextMenu(view.getByRole("application"), {
          clientX: 120,
          clientY: 120,
        });
        clickPaneAppMenuItem(view, "Identity Manager");
      },
      { timeout: PANE_LONG_ASYNC_TEST_TIMEOUT_MS },
    );
    record();

    await waitFor(
      () => {
        expect(view.getByText("Authenticated")).toBeTruthy();
      },
      { timeout: PANE_LONG_ASYNC_TEST_TIMEOUT_MS },
    );
    observer.disconnect();

    expect([...inlineStatuses]).toEqual([]);
    expect(PROGRESS_TITLES.some((title) => panelTitles.has(title))).toBe(true);

    await waitForPaneRuntimeToSettle(PANE_ASYNC_TEST_TIMEOUT_MS);
    view.unmount();
  },
  PANE_LONG_ASYNC_TEST_TIMEOUT_MS * 2,
);
