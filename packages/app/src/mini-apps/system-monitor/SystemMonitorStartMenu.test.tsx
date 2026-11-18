import { afterEach, expect, test } from "bun:test";
import { fireEvent, waitFor } from "@testing-library/react";
import { MOCK_SERVER_RESET_TIMEOUT_MS } from "../../../test/helpers/msw/server";
import {
  cleanupPaneTestEnvironment,
  clickPaneAppMenuItem,
  generateIdentityAndWaitForDb,
  PANE_ASYNC_TEST_TIMEOUT_MS,
  renderPane,
} from "../../../test/helpers/paneTestUtils";
import { systemMonitorModeStorageKey } from "./systemMonitorMode";

afterEach(cleanupPaneTestEnvironment, MOCK_SERVER_RESET_TIMEOUT_MS);

const MODE_KEY = systemMonitorModeStorageKey("left");

const MENU_OPENERS = [
  {
    label: "Start menu",
    open: (view: ReturnType<typeof renderPane>) => {
      fireEvent.click(view.getByRole("button", { name: "Menu" }));
      clickPaneAppMenuItem(view, "System Monitor");
    },
  },
  {
    label: "Start menu app context menu",
    open: (view: ReturnType<typeof renderPane>) => {
      fireEvent.click(view.getByRole("button", { name: "Menu" }));
      const monitor = view.getByRole("button", { name: "System Monitor" });
      expect(fireEvent.contextMenu(monitor)).toBe(false);
      const open = view.getByRole("button", { name: "Open" });
      expect(open.closest(".menu")?.textContent).toBe("Open");
      expect(view.container.querySelector(".window")).toBeNull();
      fireEvent.keyDown(open, { key: "Escape" });
      expect(document.activeElement).toBe(monitor);
      fireEvent.contextMenu(monitor);
      const action = view.getByRole("button", { name: "Open" });
      fireEvent.mouseDown(action);
      fireEvent.mouseUp(action);
      fireEvent.click(action);
      expect(view.baseElement.querySelector(".menu")).toBeNull();
    },
  },
  {
    label: "pane context menu",
    open: (view: ReturnType<typeof renderPane>) => {
      fireEvent.contextMenu(view.getByRole("application"), {
        clientX: 120,
        clientY: 120,
      });
      clickPaneAppMenuItem(view, "System Monitor");
    },
  },
] as const;

for (const menuOpener of MENU_OPENERS) {
  test(
    `${menuOpener.label} opens one window when the monitor is pinned`,
    async () => {
      const view = renderPane({ pinSystemMonitor: true });
      await generateIdentityAndWaitForDb(view);

      menuOpener.open(view);
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
    },
    PANE_ASYNC_TEST_TIMEOUT_MS,
  );
}
