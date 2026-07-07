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
} from "../../components/pane/DualPaneProvider";
import { Pane } from "../../components/pane/Pane";
import { PaneProvider } from "../../components/pane/PaneProvider";
import { appFeatureFlagStorageKey } from "../../providers/feature-flags/appFeatureFlags";
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
const PASSKEYS_FEATURE_FLAG_KEY = appFeatureFlagStorageKey("passkeys");
const LINKED_DOCUMENT_ACTIVATION_CONTROLS_FEATURE_FLAG_KEY =
  appFeatureFlagStorageKey("linked-document-activation-controls");
const ROUTED_DEVELOPER_MENU_ITEM_LABELS = [
  "Force Online",
  "Force Offline",
  "Restore Key Package",
] as const;

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

function expectRoutedDeveloperMenuItems(
  view: ReturnType<typeof renderPane>,
  visible: boolean,
) {
  for (const label of ROUTED_DEVELOPER_MENU_ITEM_LABELS) {
    const item = view.queryByRole("button", { name: label });
    if (visible) {
      expect(item).toBeTruthy();
    } else {
      expect(item).toBeNull();
    }
  }
}

async function clickWindowViewMenuItem(
  view: ReturnType<typeof renderPane>,
  name: string,
) {
  fireEvent.click(view.getByRole("menuitem", { name: "View" }));
  fireEvent.click(await view.findByRole("menuitem", { name }));
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
    fireEvent.click(view.getByRole("link", { name: "System Monitor" }));

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

    fireEvent.click(view.getByRole("link", { name: "System Monitor" }));
    expect(await view.findByRole("tab", { name: "Logs" })).toBeTruthy();

    fireEvent.click(
      await view.findByRole("button", { name: "Pin to Home Screen" }),
    );

    await waitFor(() => {
      expect(
        view.getByRole("link", { name: "Home" }).getAttribute("aria-current"),
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

test("developer mode toggles from the routed monitor menu and gates pane commands", async () => {
  const view = renderRoutedPane();

  fireEvent.click(view.getByRole("link", { name: "System Monitor" }));
  await view.findByRole("tab", { name: "Logs" });
  expectRoutedDeveloperMenuItems(view, false);
  expect(globalThis.localStorage.getItem(DEVELOPER_MODE_KEY)).toBeNull();

  fireEvent.click(
    await view.findByRole("button", { name: "Enable Developer Mode" }),
  );

  expect(globalThis.localStorage.getItem(DEVELOPER_MODE_KEY)).toBe("enabled");
  expectRoutedDeveloperMenuItems(view, true);

  fireEvent.click(
    await view.findByRole("button", { name: "Disable Developer Mode" }),
  );

  expect(globalThis.localStorage.getItem(DEVELOPER_MODE_KEY)).toBe("disabled");
  expectRoutedDeveloperMenuItems(view, false);

  view.unmount();
});

test("feature flags tab is developer-only and toggles app flags", async () => {
  const view = renderPane({ pinSystemMonitor: false });

  fireEvent.click(view.getByRole("button", { name: "System Monitor" }));
  await view.findByRole("tab", { name: "Logs" });
  expect(view.queryByRole("tab", { name: "Feature Flags" })).toBeNull();
  expect(globalThis.localStorage.getItem(PASSKEYS_FEATURE_FLAG_KEY)).toBeNull();
  expect(
    globalThis.localStorage.getItem(
      LINKED_DOCUMENT_ACTIVATION_CONTROLS_FEATURE_FLAG_KEY,
    ),
  ).toBeNull();

  await clickWindowViewMenuItem(view, "Enable Developer Mode");

  const featureFlagsTab = await view.findByRole("tab", {
    name: "Feature Flags",
  });
  fireEvent.click(featureFlagsTab);

  const passkeysToggle = view.getByRole("switch", {
    name: "Enable passkeys",
  }) as HTMLInputElement;
  const linkedDocumentActivationControlsToggle = view.getByRole("switch", {
    name: "Enable linked document activation controls",
  }) as HTMLInputElement;
  expect(passkeysToggle.checked).toBe(false);
  expect(linkedDocumentActivationControlsToggle.checked).toBe(false);
  expect(view.getAllByText("Disabled")).toHaveLength(2);

  fireEvent.click(passkeysToggle);

  await waitFor(() => {
    expect(passkeysToggle.checked).toBe(true);
    expect(globalThis.localStorage.getItem(PASSKEYS_FEATURE_FLAG_KEY)).toBe(
      "enabled",
    );
    expect(view.getByText("Enabled")).toBeTruthy();
  });

  fireEvent.click(linkedDocumentActivationControlsToggle);

  await waitFor(() => {
    expect(linkedDocumentActivationControlsToggle.checked).toBe(true);
    expect(
      globalThis.localStorage.getItem(
        LINKED_DOCUMENT_ACTIVATION_CONTROLS_FEATURE_FLAG_KEY,
      ),
    ).toBe("enabled");
    expect(view.getAllByText("Enabled")).toHaveLength(2);
  });

  await clickWindowViewMenuItem(view, "Disable Developer Mode");

  expect(view.queryByRole("tab", { name: "Feature Flags" })).toBeNull();

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
