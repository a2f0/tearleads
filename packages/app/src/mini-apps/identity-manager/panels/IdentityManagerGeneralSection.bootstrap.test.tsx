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

const CREATING_ACCOUNT = "Creating your account";

test(
  "identity manager shows account setup as one panel, not inline status lines",
  async () => {
    // Hold registration so the account stays mid-creation until the test has
    // seen the panel, whatever the timing of opening the window.
    let releaseRegistration = () => {};
    const registrationHeld = new Promise<void>((resolve) => {
      releaseRegistration = resolve;
    });
    useTestApiAppHandlers({
      holdRequest: (request) =>
        new URL(request.url).pathname.endsWith("/auth/register")
          ? registrationHeld
          : undefined,
    });
    const view = renderPane({
      hostConfig: createTestHostConfig({ autoProvisionIdentity: true }),
    });
    const inlineStatuses = new Set<string>();
    const record = () => {
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

    try {
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
      // A windowed Identity Manager opens on its section menu.
      const [general] = view.getAllByRole("button", { name: "General" });
      if (general) fireEvent.click(general);

      await waitFor(
        () => {
          const titles = [
            ...view.container.querySelectorAll(
              ".identity-manager .mini-app-state-panel-title",
            ),
          ].map((heading) => heading.textContent);
          expect(titles).toContain(CREATING_ACCOUNT);
        },
        { timeout: PANE_LONG_ASYNC_TEST_TIMEOUT_MS },
      );
      record();
      expect(view.queryByRole("button", { name: "Register" })).toBeNull();
    } finally {
      releaseRegistration();
    }

    await waitFor(
      () => {
        expect(view.getByText("Authenticated")).toBeTruthy();
      },
      { timeout: PANE_LONG_ASYNC_TEST_TIMEOUT_MS },
    );
    observer.disconnect();
    expect([...inlineStatuses]).toEqual([]);

    await waitForPaneRuntimeToSettle(PANE_ASYNC_TEST_TIMEOUT_MS);
    view.unmount();
  },
  PANE_LONG_ASYNC_TEST_TIMEOUT_MS * 2,
);
