import { afterEach, expect, test } from "bun:test";
import { createSQLiteRuntime } from "@tearleads/client-sdk/sqlite";
import {
  cleanup,
  fireEvent,
  render,
  waitFor,
  within,
} from "@testing-library/react";
import { useEffect } from "react";
import { withManualIdentity } from "../test/helpers/manualIdentityProfile";
import { MockWorker } from "../test/helpers/mockWorker";
import { enableSystemMonitorDeveloperMode } from "../test/helpers/systemMonitorTestPreferences";
import { App } from "./App";
import {
  DualPaneProvider,
  PaneSideProvider,
} from "./components/pane/DualPaneProvider";
import { Pane } from "./components/pane/Pane";
import { PaneProvider } from "./components/pane/PaneProvider";
import { APP_HOST_PROFILES, createAppHostConfig } from "./host/AppHostConfig";
import {
  saveSystemMonitorMode,
  systemMonitorModeStorageKey,
} from "./mini-apps/system-monitor/systemMonitorMode";
import type { AppNavigationMode } from "./navigation/AppNavigationMode";
import { useDeviceFirstContainerContents } from "./stores/device-first/DeviceFirstProvider";

// In windowed mode the System Monitor (worker status + boot log) defaults to a
// closed window. These full-app smoke tests assert on that inline status, so
// pin the monitor for both pane sides before rendering.
function pinWindowedSystemMonitors() {
  for (const side of ["left", "right"] as const) {
    saveSystemMonitorMode(systemMonitorModeStorageKey(side), "pinned");
  }
}

type TestAppHostConfigOptions = Partial<
  Pick<
    Parameters<typeof createAppHostConfig>[0],
    "createSQLiteRuntime" | "navigationMode" | "profile"
  >
> & {
  // Keep the profile's identity autopilot on. Defaults to off so these smoke
  // tests drive the manual generate/register flow without it provisioning first.
  readonly autoProvisionIdentity?: boolean | undefined;
};

function createTestAppHostConfig({
  autoProvisionIdentity = false,
  profile = APP_HOST_PROFILES.app,
  ...options
}: TestAppHostConfigOptions = {}) {
  return createAppHostConfig({
    apiBaseUrl: "http://localhost:3001",
    createSQLiteRuntime: () =>
      createSQLiteRuntime({
        workerConstructor: MockWorker,
      }),
    profile: autoProvisionIdentity ? profile : withManualIdentity(profile),
    wsUrl: "ws://localhost:3002",
    ...options,
  });
}

interface DeviceFirstIdentitySnapshot {
  reconciler: unknown;
  view: unknown;
}

function DeviceFirstIdentityProbe({
  onSnapshot,
  onUnmount,
}: {
  onSnapshot: (snapshot: DeviceFirstIdentitySnapshot) => void;
  onUnmount: () => void;
}) {
  const { reconciler, view } = useDeviceFirstContainerContents();

  useEffect(() => {
    return onUnmount;
  }, [onUnmount]);

  useEffect(() => {
    onSnapshot({ reconciler, view });
  }, [onSnapshot, reconciler, view]);

  return null;
}

function PaneNavigationHarness({
  hostConfig,
  navigationMode,
  onDeviceFirstSnapshot,
  onDeviceFirstUnmount,
}: {
  hostConfig: ReturnType<typeof createTestAppHostConfig>;
  navigationMode: AppNavigationMode;
  onDeviceFirstSnapshot: (snapshot: DeviceFirstIdentitySnapshot) => void;
  onDeviceFirstUnmount: () => void;
}) {
  return (
    <DualPaneProvider>
      <PaneSideProvider side="left">
        <PaneProvider hostConfig={hostConfig}>
          <DeviceFirstIdentityProbe
            onSnapshot={onDeviceFirstSnapshot}
            onUnmount={onDeviceFirstUnmount}
          />
          <Pane
            className="pane"
            navigationMode={navigationMode}
            routedVisible
          />
        </PaneProvider>
      </PaneSideProvider>
    </DualPaneProvider>
  );
}

afterEach(() => {
  cleanup();
  globalThis.localStorage.clear();
});

test("renders App", async () => {
  const originalWebSocket = globalThis.WebSocket;

  class SilentWebSocket extends EventTarget {
    constructor(_url: string | URL) {
      super();
    }

    close() {}
  }

  try {
    Reflect.set(globalThis, "WebSocket", SilentWebSocket);

    pinWindowedSystemMonitors();
    const view = render(<App hostConfig={createTestAppHostConfig()} />);

    expect(
      view.getAllByText(/sqlite worker: idle/).length,
    ).toBeGreaterThanOrEqual(1);
    expect(
      view.getAllByText(
        /Generate a key pair from the pane menu to boot this pane\./,
      ).length,
    ).toBeGreaterThanOrEqual(1);

    const firstMenuButton = view.getAllByText("Menu")[0];
    if (!firstMenuButton) {
      throw new Error("Expected a pane menu button.");
    }

    view.unmount();
  } finally {
    Reflect.set(globalThis, "WebSocket", originalWebSocket);
  }
});

test("normal App is single-pane with no split toggle", () => {
  const view = render(<App hostConfig={createTestAppHostConfig()} />);

  const frame = view.container.querySelector(".tearleads-frame.layout");
  expect(frame?.classList.contains("layout--split")).toBe(false);
  // The regular app never splits, so there is no split/peer toggle in chrome.
  expect(view.queryByRole("button", { name: "Split" })).toBeNull();
  expect(view.queryByRole("button", { name: "Show Peer" })).toBeNull();
  expect(view.queryByRole("button", { name: /Navigation mode/i })).toBeNull();
  expect(view.queryByText("Peer 1")).toBeNull();
  expect(view.queryByText("Peer 2")).toBeNull();
  view.unmount();
});

test("demo App starts split", () => {
  const view = render(
    <App
      hostConfig={createTestAppHostConfig({
        profile: APP_HOST_PROFILES.demo,
      })}
    />,
  );

  const frame = view.container.querySelector(".tearleads-frame.layout");
  expect(frame?.classList.contains("layout--split")).toBe(true);
  expect(frame?.classList.contains("layout--demo-peer-split")).toBe(true);
  expect(view.getByText("Peer 1")).toBeTruthy();
  expect(view.getByText("Peer 2")).toBeTruthy();
  // The demo's panes are peers, so the split toggle reads as hiding/showing the
  // peer rather than a generic split/unsplit.
  const toggle = view.getByRole("button", { name: "Hide Peer" });
  fireEvent.click(toggle);
  expect(frame?.classList.contains("layout--demo-peer-split")).toBe(false);
  expect(view.queryByText("Peer 1")).toBeNull();
  expect(view.queryByText("Peer 2")).toBeNull();
  expect(view.getByRole("button", { name: "Show Peer" })).toBeTruthy();
  view.unmount();
});

test("routed App home can generate a pane key pair from shell chrome", async () => {
  const originalWebSocket = globalThis.WebSocket;

  class SilentWebSocket extends EventTarget {
    constructor(_url: string | URL) {
      super();
    }

    close() {}
  }

  try {
    Reflect.set(globalThis, "WebSocket", SilentWebSocket);

    const view = render(
      <App
        hostConfig={createTestAppHostConfig({
          navigationMode: "routed",
        })}
      />,
    );

    // The redesigned routed shell renders the navigation/system actions
    // inline in the rail (tablet) or drawer (mobile) instead of behind a
    // "Pane" popover, so there is no "Pane" or "Menu" button.
    expect(view.queryByRole("button", { name: "Pane" })).toBeNull();
    expect(view.queryByRole("button", { name: "Menu" })).toBeNull();
    expect(
      view.queryByText(/Generate a key pair to boot this pane\./),
    ).toBeNull();
    expect(view.queryByText(/sqlite worker:/)).toBeNull();
    expect(
      view.getByRole("link", { name: "Home" }).getAttribute("aria-current"),
    ).toBe("page");

    // System actions live directly in the rail — no popover to open first.
    expect(
      view.queryByRole("button", { name: "Restore Key Package" }),
    ).toBeNull();
    const generateKeyPairButton = view.getAllByRole("button", {
      name: "Generate Key Pair",
    })[1];
    if (!generateKeyPairButton) {
      throw new Error("Expected routed rail generate action.");
    }
    fireEvent.click(generateKeyPairButton);

    await waitFor(() => {
      expect(view.getByRole("button", { name: "Open Contacts" })).toBeTruthy();
      expect(
        view.queryByRole("button", { name: "Destroy Key Pair" }),
      ).toBeNull();
    });

    fireEvent.click(view.getByRole("link", { name: "Contacts" }));

    // The mini-app sidebar mounts when expanded and unmounts when hidden
    // (conditional render), rather than toggling an inline display style.
    await waitFor(() => {
      expect(
        view
          .getByRole("link", { name: "Contacts" })
          .getAttribute("aria-current"),
      ).toBe("page");
      expect(view.getByRole("button", { name: "Hide Sidebar" })).toBeTruthy();
      const sidebar = view.container.querySelector<HTMLElement>(
        "#routed-pane-sidebar",
      );
      if (!sidebar) {
        throw new Error("Expected routed pane sidebar to be mounted.");
      }
      expect(within(sidebar).getByRole("button", { name: "You" })).toBeTruthy();
    });

    fireEvent.click(view.getByRole("button", { name: "Hide Sidebar" }));
    expect(view.container.querySelector("#routed-pane-sidebar")).toBeNull();
    expect(
      view
        .getByRole("button", { name: "Show Sidebar" })
        .getAttribute("aria-expanded"),
    ).toBe("false");

    fireEvent.click(view.getByRole("button", { name: "Show Sidebar" }));
    expect(view.container.querySelector("#routed-pane-sidebar")).toBeTruthy();

    const homeLink = view.getByRole("link", { name: "Home" });
    fireEvent.click(homeLink);

    await waitFor(() => {
      expect(
        view.getByRole("link", { name: "Home" }).getAttribute("aria-current"),
      ).toBe("page");
      expect(view.queryByRole("button", { name: "Hide Sidebar" })).toBeNull();
    });

    // Developer-only key destruction stays hidden from normal users.
    expect(view.queryByRole("button", { name: "Destroy Key Pair" })).toBeNull();

    view.unmount();
  } finally {
    Reflect.set(globalThis, "WebSocket", originalWebSocket);
  }
});

test("switching navigation mode reuses the booted pane database instead of rebooting it", async () => {
  const originalWebSocket = globalThis.WebSocket;

  class SilentWebSocket extends EventTarget {
    constructor(_url: string | URL) {
      super();
    }

    close() {}
  }

  // Count SQLite worker creations: a windowed<->routed toggle that tore the
  // pane's provider subtree down and rebuilt it (the regressed behaviour) would
  // create a second runtime. The fix keeps the PaneProvider mounted across the
  // toggle, so exactly one runtime is ever created for the active pane.
  let runtimeCreations = 0;

  try {
    Reflect.set(globalThis, "WebSocket", SilentWebSocket);

    enableSystemMonitorDeveloperMode();
    pinWindowedSystemMonitors();
    const view = render(
      <App
        hostConfig={createTestAppHostConfig({
          createSQLiteRuntime: () => {
            runtimeCreations += 1;
            return createSQLiteRuntime({ workerConstructor: MockWorker });
          },
        })}
      />,
    );

    const toggleNavigationMode = () =>
      fireEvent.click(view.getByRole("button", { name: /Navigation mode/i }));

    // Drive into routed mode (override cycle: auto -> windowed -> routed) and
    // boot the single visible pane's database from the routed rail.
    toggleNavigationMode();
    toggleNavigationMode();
    const generateButtons = view.getAllByRole("button", {
      name: "Generate Key Pair",
    });
    const generate = generateButtons[generateButtons.length - 1];
    if (!generate) {
      throw new Error("Expected a routed generate-key action.");
    }
    fireEvent.click(generate);

    await waitFor(() => {
      expect(view.container.textContent ?? "").toMatch(
        /sqlite worker:\s*ready/,
      );
    });
    expect(runtimeCreations).toBe(1);

    // Cross back to a windowed layout (override cycle: routed -> auto ->
    // windowed). The active pane's worker must be the same one, not a reboot.
    toggleNavigationMode();
    toggleNavigationMode();

    await waitFor(() => {
      expect(view.container.textContent ?? "").toMatch(
        /sqlite worker:\s*ready/,
      );
    });
    expect(runtimeCreations).toBe(1);

    view.unmount();
  } finally {
    Reflect.set(globalThis, "WebSocket", originalWebSocket);
  }
});

test("device-first sync binding survives windowed and routed layout switches", async () => {
  const hostConfig = createTestAppHostConfig();
  const snapshots: DeviceFirstIdentitySnapshot[] = [];
  const captureSnapshot = (snapshot: DeviceFirstIdentitySnapshot) => {
    snapshots.push(snapshot);
  };
  let unmounts = 0;
  const captureUnmount = () => {
    unmounts += 1;
  };
  const view = render(
    <PaneNavigationHarness
      hostConfig={hostConfig}
      navigationMode="windowed"
      onDeviceFirstSnapshot={captureSnapshot}
      onDeviceFirstUnmount={captureUnmount}
    />,
  );

  await waitFor(() => {
    expect(snapshots.length).toBeGreaterThan(0);
  });
  const firstSnapshot = snapshots.at(-1);
  if (!firstSnapshot) {
    throw new Error("Expected the device-first binding to mount.");
  }

  view.rerender(
    <PaneNavigationHarness
      hostConfig={hostConfig}
      navigationMode="routed"
      onDeviceFirstSnapshot={captureSnapshot}
      onDeviceFirstUnmount={captureUnmount}
    />,
  );
  await waitFor(() => {
    expect(snapshots.at(-1)?.view).toBe(firstSnapshot.view);
    expect(snapshots.at(-1)?.reconciler).toBe(firstSnapshot.reconciler);
  });
  expect(unmounts).toBe(0);

  view.rerender(
    <PaneNavigationHarness
      hostConfig={hostConfig}
      navigationMode="windowed"
      onDeviceFirstSnapshot={captureSnapshot}
      onDeviceFirstUnmount={captureUnmount}
    />,
  );
  await waitFor(() => {
    expect(snapshots.at(-1)?.view).toBe(firstSnapshot.view);
    expect(snapshots.at(-1)?.reconciler).toBe(firstSnapshot.reconciler);
  });
  expect(unmounts).toBe(0);

  view.unmount();
  expect(unmounts).toBe(1);
});
