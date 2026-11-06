import { afterEach, expect, test } from "bun:test";
import { fireEvent, waitFor, within } from "@testing-library/react";
import {
  MOCK_SERVER_RESET_TIMEOUT_MS,
  useTestApiAppHandlers,
} from "../../../test/helpers/msw/server";
import {
  cleanupPaneTestEnvironment,
  clickPaneAppMenuItem,
  createTestHostConfig,
  PANE_ASYNC_TEST_TIMEOUT_MS,
  PANE_LONG_ASYNC_TEST_TIMEOUT_MS,
  renderPane,
  waitForPaneRuntimeToSettle,
} from "../../../test/helpers/paneTestUtils";

afterEach(cleanupPaneTestEnvironment, MOCK_SERVER_RESET_TIMEOUT_MS);

const SIGN_IN_TITLE = "Log in to manage organizations";
const PROGRESS_TITLES = [
  "Restoring your session",
  "Creating your identity",
  "Creating your account",
  "Signing you in",
  "Loading your organizations",
];

function openPaneMenu(view: ReturnType<typeof renderPane>) {
  fireEvent.contextMenu(view.getByRole("application"), {
    clientX: 120,
    clientY: 120,
  });
}

// The pane menu lists Org Manager once the pane holds an identity key pair.
async function openOrgManager(view: ReturnType<typeof renderPane>) {
  await waitFor(
    () => {
      openPaneMenu(view);
      clickPaneAppMenuItem(view, "Org Manager");
    },
    { timeout: PANE_LONG_ASYNC_TEST_TIMEOUT_MS },
  );
}

test(
  "org manager shows provisioning progress, never a login prompt, on a fresh device",
  async () => {
    // The real API runtime serves the organization read model Org Manager
    // loads once the account is signed in.
    useTestApiAppHandlers();
    const view = renderPane({
      hostConfig: createTestHostConfig({ autoProvisionIdentity: true }),
    });
    const seen = new Set<string>();
    const record = () => {
      for (const heading of view.container.querySelectorAll(
        ".mini-app-state-panel-title",
      )) {
        seen.add(heading.textContent ?? "");
      }
    };
    const observer = new MutationObserver(record);
    observer.observe(view.container, {
      characterData: true,
      childList: true,
      subtree: true,
    });

    await openOrgManager(view);
    record();

    await waitFor(
      () => {
        expect(view.getByRole("button", { name: "Groups" })).toBeTruthy();
      },
      { timeout: PANE_LONG_ASYNC_TEST_TIMEOUT_MS },
    );
    observer.disconnect();

    expect(seen.has(SIGN_IN_TITLE)).toBe(false);
    expect(PROGRESS_TITLES.some((title) => seen.has(title))).toBe(true);

    await waitForPaneRuntimeToSettle(PANE_ASYNC_TEST_TIMEOUT_MS);
    view.unmount();
  },
  PANE_LONG_ASYNC_TEST_TIMEOUT_MS * 2,
);

test(
  "org manager asks to log in when nothing is provisioning the account",
  async () => {
    const view = renderPane({ hostConfig: createTestHostConfig() });

    openPaneMenu(view);
    clickPaneAppMenuItem(view, "Generate Key Pair");
    await openOrgManager(view);

    const panel = await view.findByRole(
      "heading",
      { name: SIGN_IN_TITLE },
      { timeout: PANE_ASYNC_TEST_TIMEOUT_MS },
    );
    const root = panel.closest<HTMLElement>(".mini-app-state-panel");
    expect(root).not.toBeNull();
    expect(within(root as HTMLElement).queryByRole("status")).toBeNull();

    view.unmount();
  },
  PANE_LONG_ASYNC_TEST_TIMEOUT_MS,
);
