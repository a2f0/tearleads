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
import {
  createTestAppHostConfig,
  pinWindowedSystemMonitors,
} from "../test/helpers/appTestHostConfig";
import { MockWorker } from "../test/helpers/mockWorker";
import { getAllPaneStatusTexts } from "../test/helpers/paneTestUtils";
import { App } from "./App";
import {
  DualPaneProvider,
  PaneSideProvider,
} from "./components/pane/dual-pane";
import { PaneProvider } from "./components/pane/runtime/PaneProvider";
import { Pane } from "./components/pane/shell/Pane";
import type { AppNavigationMode } from "./navigation/AppNavigationMode";
import { useDeviceFirstContainerContents } from "./stores/device-first/DeviceFirstProvider";

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
      getAllPaneStatusTexts(view).some((text) =>
        /sqlite worker:\s*idle/.test(text),
      ),
    ).toBe(true);
    expect(
      view.getAllByText(
        /Generate a key pair from the pane menu to boot this pane\./,
      ).length,
    ).toBeGreaterThanOrEqual(1);

    const firstMenuButton = view.getAllByRole("button", { name: "Menu" })[0];
    if (!firstMenuButton) {
      throw new Error("Expected a pane menu button.");
    }

    view.unmount();
  } finally {
    Reflect.set(globalThis, "WebSocket", originalWebSocket);
  }
});

test("routed App boots from the Explorer home gate and navigates via the rail", async () => {
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

    // The redesigned routed shell renders app navigation inline in the rail
    // (tablet) or launcher sheet (mobile) instead of behind a "Pane" popover,
    // so there is no "Pane" button.
    expect(view.queryByRole("button", { name: "Pane" })).toBeNull();
    // The bottom taskbar's centered logo is the routed shell's "Menu"
    // affordance in both tiers (toggling the rail on tablet, the launcher
    // sheet on mobile) — not the old windowed pane-menu popover.
    expect(view.getByRole("button", { name: "Menu" })).toBeTruthy();
    expect(view.queryByText(/SQLite Worker/i)).toBeNull();

    // The navigation rail now defaults to collapsed, so its links stay hidden
    // behind the expand toggle until the user opens it.
    expect(view.queryByRole("link", { name: "Home" })).toBeNull();
    expect(
      view.getByRole("button", { name: "Expand navigation rail" }),
    ).toBeTruthy();

    // Home is the Explorer app itself (like the mobile compact view), so with
    // no key yet it shows Explorer's setup gate, whose "Generate Key Pair"
    // action boots the pane once the persisted-identity restore settles.
    await waitFor(() => {
      expect(
        view.getAllByRole("button", { name: "Generate Key Pair" }).length,
      ).toBeGreaterThan(0);
    });
    const generateButtons = view.getAllByRole("button", {
      name: "Generate Key Pair",
    });
    const generateKeyPairButton = generateButtons[generateButtons.length - 1];
    if (!generateKeyPairButton) {
      throw new Error("Expected Explorer's generate-key gate.");
    }
    fireEvent.click(generateKeyPairButton);

    // Once the key exists the gate clears and no generate action remains.
    await waitFor(() => {
      expect(
        view.queryByRole("button", { name: "Generate Key Pair" }),
      ).toBeNull();
    });

    // Expand the rail to reach the app links; Explorer is the active home app.
    fireEvent.click(
      view.getByRole("button", { name: "Expand navigation rail" }),
    );
    await waitFor(() => {
      expect(
        view
          .getByRole("link", { name: "Explorer" })
          .getAttribute("aria-current"),
      ).toBe("page");
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

    // Key destruction belongs to the Identity Manager app, never the shell.
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

    // Drive into routed mode from the preserved lower-right footer switch and
    // boot the single visible pane's database from the routed rail.
    fireEvent.click(
      view.getByRole("button", { name: "Switch to iPad / mobile layout" }),
    );
    // In routed mode the generate action lives in Explorer's home gate, which
    // only offers it once the persisted-identity restore settles.
    await waitFor(() => {
      expect(
        view.getAllByRole("button", { name: "Generate Key Pair" }).length,
      ).toBeGreaterThan(0);
    });
    const generateButtons = view.getAllByRole("button", {
      name: "Generate Key Pair",
    });
    const generate = generateButtons[generateButtons.length - 1];
    if (!generate) {
      throw new Error("Expected a routed generate-key action.");
    }
    fireEvent.click(generate);

    await waitFor(() => {
      expect(
        getAllPaneStatusTexts(view).some((text) =>
          /sqlite worker:\s*ready/.test(text),
        ),
      ).toBe(true);
    });
    expect(runtimeCreations).toBe(1);

    // Cross back through the lower-right taskbar switch. The active pane's
    // worker must be the same one, not a reboot.
    fireEvent.click(
      view.getByRole("button", { name: "Switch to windowed layout" }),
    );

    await waitFor(() => {
      expect(
        getAllPaneStatusTexts(view).some((text) =>
          /sqlite worker:\s*ready/.test(text),
        ),
      ).toBe(true);
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
