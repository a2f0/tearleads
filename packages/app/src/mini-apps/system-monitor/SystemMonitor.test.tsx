import { afterEach, expect, test } from "bun:test";
import { fireEvent, render, waitFor } from "@testing-library/react";
import {
  cleanupPaneTestEnvironment,
  createTestHostConfig,
  getPaneStatusText,
  PANE_ASYNC_TEST_TIMEOUT_MS,
  renderPane,
} from "../../../test/helpers/paneTestUtils";
import {
  DualPaneProvider,
  PaneSideProvider,
} from "../../components/pane/dual-pane";
import { PaneProvider } from "../../components/pane/runtime/PaneProvider";
import { Pane } from "../../components/pane/shell/Pane";
import {
  systemMonitorDeveloperModeStorageKey,
  systemMonitorModeStorageKey,
} from "./systemMonitorMode";

afterEach(async () => {
  await cleanupPaneTestEnvironment();
  window.history.replaceState(null, "", "/");
});

// renderPane() mounts the left pane, so the persisted mode lands under this key.
const MODE_KEY = systemMonitorModeStorageKey("left");
const DEVELOPER_MODE_KEY = systemMonitorDeveloperModeStorageKey();

function spyPushState(onPush: (url: string | URL | null | undefined) => void) {
  const originalPushState = window.history.pushState;
  window.history.pushState = function pushStateSpy(
    data: unknown,
    unused: string,
    url?: string | URL | null,
  ) {
    onPush(url);
    return originalPushState.call(window.history, data, unused, url);
  };
  return () => {
    window.history.pushState = originalPushState;
  };
}

function renderRoutedPane() {
  window.history.replaceState(null, "", "/");

  return render(
    <DualPaneProvider>
      <PaneSideProvider side="left">
        <PaneProvider hostConfig={createTestHostConfig()}>
          <Pane className="pane" navigationMode="routed" routedVisible />
        </PaneProvider>
      </PaneSideProvider>
    </DualPaneProvider>,
  );
}

function openRoutedMiniAppLink(
  view: ReturnType<typeof renderRoutedPane>,
  name: string,
) {
  // The routed nav rail defaults to collapsed, so open it (when it isn't
  // already) before reaching the app links it hosts.
  const expandRail = view.queryByRole("button", {
    name: "Expand navigation rail",
  });
  if (expandRail) {
    fireEvent.click(expandRail);
  }
  fireEvent.click(view.getByRole("link", { name }));
}

// Developer mode gates the Feature Flags tab, the routed shell's visible
// consequence of the toggle now that the nav rail carries app links only.
function expectRoutedDeveloperTab(
  view: ReturnType<typeof renderPane>,
  visible: boolean,
) {
  const tab = view.queryByRole("tab", { name: "Feature Flags" });
  if (visible) {
    expect(tab).toBeTruthy();
  } else {
    expect(tab).toBeNull();
  }
}

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
  expect(view.queryByRole("tab", { name: "Feature Flags" })).toBeNull();

  // Logs tab is active first; the boot prompt shows, status does not.
  expect(
    view.getByText(
      /Generate a key pair from the pane menu to boot this pane\./,
    ),
  ).toBeTruthy();
  expect(view.queryByText(/SQLite Worker/i)).toBeNull();

  fireEvent.click(view.getByRole("tab", { name: "Status" }));

  await waitFor(() => {
    expect(view.getByText(/SQLite Worker/i)).toBeTruthy();
  });

  view.unmount();
});

test("right-clicking the system monitor controls network mode", async () => {
  const view = renderPane({ pinSystemMonitor: false });

  fireEvent.contextMenu(view.getByRole("button", { name: "System Monitor" }), {
    clientX: 20,
    clientY: 20,
  });
  fireEvent.click(await view.findByRole("button", { name: "Force Offline" }));

  fireEvent.click(view.getByRole("button", { name: "System Monitor" }));
  fireEvent.click(await view.findByRole("tab", { name: "Status" }));

  await waitFor(() => {
    expect(getPaneStatusText(view)).toMatch(/network:\s*offline \(manual\)/);
  });

  const systemMonitor =
    view.container.querySelector<HTMLElement>(".system-monitor");
  if (!systemMonitor) {
    throw new Error("Expected System Monitor app root.");
  }

  fireEvent.contextMenu(systemMonitor, { clientX: 30, clientY: 30 });
  fireEvent.click(await view.findByRole("button", { name: "Force Online" }));

  await waitFor(() => {
    expect(getPaneStatusText(view)).toMatch(/network:\s*online \(manual\)/);
  });

  view.unmount();
});

test("right-clicking selected system monitor text keeps the browser menu", async () => {
  const view = renderPane({ pinSystemMonitor: false });
  const originalGetSelection = window.getSelection;

  fireEvent.click(view.getByRole("button", { name: "System Monitor" }));
  await view.findByRole("tab", { name: "Logs" });

  const systemMonitor =
    view.container.querySelector<HTMLElement>(".system-monitor");
  if (!systemMonitor) {
    throw new Error("Expected System Monitor app root.");
  }

  Object.defineProperty(window, "getSelection", {
    configurable: true,
    value: () =>
      ({
        toString: () => "selected monitor text",
      }) as Selection,
  });

  try {
    expect(
      fireEvent.contextMenu(systemMonitor, { clientX: 30, clientY: 30 }),
    ).toBe(true);
    expect(view.queryByRole("button", { name: "Force Offline" })).toBeNull();
  } finally {
    Object.defineProperty(window, "getSelection", {
      configurable: true,
      value: originalGetSelection,
    });
    view.unmount();
  }
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
  expect(view.getByText(/SQLite Worker/i)).toBeTruthy();

  // ArrowLeft wraps back to the first tab.
  fireEvent.keyDown(statusTab, { key: "ArrowLeft" });
  await waitFor(() => {
    expect(logsTab.getAttribute("aria-selected")).toBe("true");
  });

  view.unmount();
});

test("routed system monitor launches from nav and tabs update the path", async () => {
  const pushedUrls: Array<string | URL | null | undefined> = [];
  const restorePushState = spyPushState((url) => pushedUrls.push(url));
  const view = renderRoutedPane();

  try {
    openRoutedMiniAppLink(view, "System Monitor");

    const logsTab = await view.findByRole("tab", { name: "Logs" });
    expect(logsTab.getAttribute("aria-selected")).toBe("true");
    expect(pushedUrls.at(-1)).toBe("/app/system-monitor");

    fireEvent.click(view.getByRole("tab", { name: "Status" }));

    await waitFor(() => {
      expect(pushedUrls.at(-1)).toBe("/app/system-monitor/status");
      expect(
        view.getByRole("tab", { name: "Status" }).getAttribute("aria-selected"),
      ).toBe("true");
    });
    expect(view.getByText(/SQLite Worker/i)).toBeTruthy();

    fireEvent.click(view.getByRole("tab", { name: "Logs" }));

    await waitFor(() => {
      expect(pushedUrls.at(-1)).toBe("/app/system-monitor");
      expect(
        view.getByRole("tab", { name: "Logs" }).getAttribute("aria-selected"),
      ).toBe("true");
    });
  } finally {
    restorePushState();
    view.unmount();
  }
});

test("routed home pins the monitor only after the System Monitor pin action", async () => {
  const pushedUrls: Array<string | URL | null | undefined> = [];
  const restorePushState = spyPushState((url) => pushedUrls.push(url));
  const view = renderRoutedPane();

  try {
    expect(view.queryByText(/SQLite Worker/i)).toBeNull();
    expect(view.container.querySelector(".pane-log")).toBeNull();
    expect(
      view.queryByRole("button", { name: "Pin to Home Screen" }),
    ).toBeNull();

    openRoutedMiniAppLink(view, "System Monitor");
    expect(await view.findByRole("tab", { name: "Logs" })).toBeTruthy();

    fireEvent.click(
      await view.findByRole("button", { name: "Pin to Home Screen" }),
    );

    await waitFor(() => {
      // Home is the Explorer app now, so the Explorer nav link (not a separate
      // "Home" entry) is the active one once the pin action navigates home.
      expect(
        view
          .getByRole("link", { name: "Explorer" })
          .getAttribute("aria-current"),
      ).toBe("page");
      expect(view.getByText(/SQLite Worker/i)).toBeTruthy();
      expect(view.container.querySelector(".pane-log")).not.toBeNull();
    });
    expect(globalThis.localStorage.getItem(MODE_KEY)).toBe("pinned");
    expect(pushedUrls.at(-1)).toBe("/");
  } finally {
    restorePushState();
    view.unmount();
  }
});

test("pin to desktop closes the window, renders inline, and persists the choice", async () => {
  const view = renderPane({ pinSystemMonitor: false });

  fireEvent.click(view.getByRole("button", { name: "System Monitor" }));
  await view.findByRole("tab", { name: "Logs" });
  expect(view.container.querySelector(".window")).not.toBeNull();
  expect(view.container.querySelector(".system-monitor-toolbar")).toBeNull();
  expect(
    view.container.querySelectorAll(".window-titlebar-buttons > button"),
  ).toHaveLength(3);
  expect(
    view
      .getByRole("button", { name: "Pin to Desktop" })
      .closest(".window-toolbar"),
  ).not.toBeNull();

  fireEvent.click(view.getByRole("menuitem", { name: "File" }));
  await waitFor(() => {
    expect(view.getByRole("menuitem", { name: "Close" })).toBeTruthy();
  });
  expect(view.queryByRole("menuitem", { name: "Pin to Desktop" })).toBeNull();

  fireEvent.click(view.getByRole("menuitem", { name: "View" }));
  await waitFor(() => {
    expect(view.getByRole("menuitem", { name: "Pin to Desktop" })).toBeTruthy();
  });

  fireEvent.click(view.getByRole("button", { name: "Pin to Desktop" }));

  await waitFor(() => {
    // The window is gone and the monitor renders inline (status + log).
    expect(view.container.querySelector(".window")).toBeNull();
    expect(view.container.querySelector(".pane-content")).not.toBeNull();
  });
  expect(view.getByText(/SQLite Worker/i)).toBeTruthy();
  expect(globalThis.localStorage.getItem(MODE_KEY)).toBe("pinned");

  view.unmount();
});

test("developer mode toggles from the routed monitor toolbar and gates its tabs", async () => {
  const view = renderRoutedPane();

  openRoutedMiniAppLink(view, "System Monitor");
  await view.findByRole("tab", { name: "Logs" });
  expectRoutedDeveloperTab(view, false);
  expect(globalThis.localStorage.getItem(DEVELOPER_MODE_KEY)).toBeNull();

  fireEvent.click(
    await view.findByRole("button", { name: "Enable Developer Mode" }),
  );

  expect(globalThis.localStorage.getItem(DEVELOPER_MODE_KEY)).toBe("enabled");
  expectRoutedDeveloperTab(view, true);

  fireEvent.click(
    await view.findByRole("button", { name: "Disable Developer Mode" }),
  );

  expect(globalThis.localStorage.getItem(DEVELOPER_MODE_KEY)).toBe("disabled");
  expectRoutedDeveloperTab(view, false);

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
