import { afterEach, expect, test } from "bun:test";
import { fireEvent, waitFor } from "@testing-library/react";
import {
  cleanupPaneTestEnvironment,
  PANE_ASYNC_TEST_TIMEOUT_MS,
  renderPane,
} from "../../../test/helpers/paneTestUtils";
import { systemMonitorModeStorageKey } from "./systemMonitorMode";

afterEach(cleanupPaneTestEnvironment);

// renderPane() mounts the left pane, so the persisted mode lands under this key.
const MODE_KEY = systemMonitorModeStorageKey("left");

test("home pane hides the monitor inline and exposes a launcher by default", () => {
  const view = renderPane({ pinSystemMonitor: false });

  // Windowed mode (the production default): nothing inline, no window, just the
  // launcher affordance.
  expect(view.container.querySelector(".pane-content")).toBeNull();
  expect(view.container.querySelector(".window")).toBeNull();
  expect(view.getByRole("button", { name: "System Monitor" })).toBeTruthy();

  view.unmount();
});

test("launcher opens a window with Logs and Status tabs", async () => {
  const view = renderPane({ pinSystemMonitor: false });

  fireEvent.click(view.getByRole("button", { name: "System Monitor" }));

  const logsTab = await view.findByRole("tab", { name: "Logs" });
  expect(logsTab.getAttribute("aria-selected")).toBe("true");
  expect(view.getByRole("tab", { name: "Status" })).toBeTruthy();

  // Logs tab is active first; the boot prompt shows, status does not.
  expect(
    view.getByText(
      /Generate a key pair from the pane menu to boot this pane\./,
    ),
  ).toBeTruthy();
  expect(view.queryByText(/sqlite worker:/)).toBeNull();

  fireEvent.click(view.getByRole("tab", { name: "Status" }));

  await waitFor(() => {
    expect(view.getByText(/sqlite worker:/)).toBeTruthy();
  });

  view.unmount();
});

test("tabs follow the roving-tabindex pattern and arrow keys switch tabs", async () => {
  const view = renderPane({ pinSystemMonitor: false });

  fireEvent.click(view.getByRole("button", { name: "System Monitor" }));
  const logsTab = await view.findByRole("tab", { name: "Logs" });
  const statusTab = view.getByRole("tab", { name: "Status" });

  // Only the active tab is in the tab order.
  expect(logsTab.getAttribute("tabindex")).toBe("0");
  expect(statusTab.getAttribute("tabindex")).toBe("-1");

  fireEvent.keyDown(logsTab, { key: "ArrowRight" });

  await waitFor(() => {
    expect(statusTab.getAttribute("aria-selected")).toBe("true");
    expect(statusTab.getAttribute("tabindex")).toBe("0");
    expect(logsTab.getAttribute("tabindex")).toBe("-1");
  });
  expect(view.getByText(/sqlite worker:/)).toBeTruthy();

  // ArrowLeft wraps back to the first tab.
  fireEvent.keyDown(statusTab, { key: "ArrowLeft" });
  await waitFor(() => {
    expect(logsTab.getAttribute("aria-selected")).toBe("true");
  });

  view.unmount();
});

test("pin to desktop closes the window, renders inline, and persists the choice", async () => {
  const view = renderPane({ pinSystemMonitor: false });

  fireEvent.click(view.getByRole("button", { name: "System Monitor" }));
  await view.findByRole("tab", { name: "Logs" });
  expect(view.container.querySelector(".window")).not.toBeNull();

  fireEvent.click(view.getByRole("button", { name: "Pin to Desktop" }));

  await waitFor(() => {
    // The window is gone and the monitor renders inline (status + log).
    expect(view.container.querySelector(".window")).toBeNull();
    expect(view.container.querySelector(".pane-content")).not.toBeNull();
  });
  expect(view.getByText(/sqlite worker:/)).toBeTruthy();
  expect(globalThis.localStorage.getItem(MODE_KEY)).toBe("pinned");

  view.unmount();
});

test("closing the window via its X button leaves the launcher to reopen it", async () => {
  const view = renderPane({ pinSystemMonitor: false });

  fireEvent.click(view.getByRole("button", { name: "System Monitor" }));
  await view.findByRole("tab", { name: "Logs" });

  const closeButton =
    view.container.querySelector<HTMLButtonElement>(".window-close");
  if (!closeButton) {
    throw new Error("Expected the window close button.");
  }
  fireEvent.click(closeButton);

  await waitFor(() => {
    expect(view.container.querySelector(".window")).toBeNull();
  });
  // Closing is not pinning: the monitor stays windowed (nothing renders inline)
  // and the launcher is still the way back in.
  expect(view.container.querySelector(".pane-content")).toBeNull();
  expect(globalThis.localStorage.getItem(MODE_KEY)).toBe("windowed");

  fireEvent.click(view.getByRole("button", { name: "System Monitor" }));
  expect(await view.findByRole("tab", { name: "Logs" })).toBeTruthy();
  expect(view.container.querySelector(".window")).not.toBeNull();

  view.unmount();
});

test("a pinned monitor renders inline (status + log) on load", () => {
  const view = renderPane({ pinSystemMonitor: true });

  expect(view.container.querySelector(".pane-content")).not.toBeNull();
  expect(view.container.querySelector(".pane-log")).not.toBeNull();
  expect(view.container.querySelector(".window")).toBeNull();
  expect(globalThis.localStorage.getItem(MODE_KEY)).toBe("pinned");

  view.unmount();
});

test("clicking the launcher while pinned pops back out to a window", async () => {
  const view = renderPane({ pinSystemMonitor: true });

  expect(view.container.querySelector(".pane-content")).not.toBeNull();

  fireEvent.click(view.getByRole("button", { name: "System Monitor" }));

  await waitFor(
    () => {
      expect(view.container.querySelector(".window")).not.toBeNull();
      // Inline render is gone once unpinned.
      expect(view.container.querySelector(".pane-content")).toBeNull();
    },
    { timeout: PANE_ASYNC_TEST_TIMEOUT_MS },
  );
  expect(globalThis.localStorage.getItem(MODE_KEY)).toBe("windowed");

  view.unmount();
});
