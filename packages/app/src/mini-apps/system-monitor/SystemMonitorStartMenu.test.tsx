import { afterEach, expect, test } from "bun:test";
import { fireEvent, waitFor } from "@testing-library/react";
import {
  cleanupPaneTestEnvironment,
  clickPaneAppMenuItem,
  generateIdentityAndWaitForDb,
  PANE_ASYNC_TEST_TIMEOUT_MS,
  renderPane,
} from "../../../test/helpers/paneTestUtils";
import { systemMonitorModeStorageKey } from "./systemMonitorMode";

afterEach(cleanupPaneTestEnvironment);

const MODE_KEY = systemMonitorModeStorageKey("left");

const MENU_OPENERS = [
  {
    label: "Start menu",
    open: (view: ReturnType<typeof renderPane>) =>
      fireEvent.click(view.getByRole("button", { name: "Menu" })),
  },
  {
    label: "pane context menu",
    open: (view: ReturnType<typeof renderPane>) =>
      fireEvent.contextMenu(view.getByRole("application"), {
        clientX: 120,
        clientY: 120,
      }),
  },
] as const;

for (const menuOpener of MENU_OPENERS) {
  test(`${menuOpener.label} opens one window when the monitor is pinned`, async () => {
    const view = renderPane({ pinSystemMonitor: true });
    await generateIdentityAndWaitForDb(view);

    menuOpener.open(view);
    clickPaneAppMenuItem(view, "System Monitor");

    await waitFor(
      () => {
        expect(view.container.querySelectorAll(".window")).toHaveLength(1);
        expect(
          view.container.querySelector(".pane-main > .pane-content"),
        ).toBeNull();
        expect(
          view.container.querySelector(".pane-main > .pane-log"),
        ).toBeNull();
      },
      { timeout: PANE_ASYNC_TEST_TIMEOUT_MS },
    );
    expect(globalThis.localStorage.getItem(MODE_KEY)).toBe("windowed");

    view.unmount();
  });
}
