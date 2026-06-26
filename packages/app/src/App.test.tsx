import { afterEach, expect, test } from "bun:test";
import { createSQLiteRuntime } from "@tearleads/client-sdk/sqlite";
import {
  cleanup,
  fireEvent,
  render,
  waitFor,
  within,
} from "@testing-library/react";
import { MockWorker } from "../test/helpers/mockWorker";
import { App } from "./App";
import { APP_HOST_PROFILES, createAppHostConfig } from "./host/AppHostConfig";
import {
  saveSystemMonitorMode,
  systemMonitorModeStorageKey,
} from "./mini-apps/system-monitor/systemMonitorMode";

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
>;

function createTestAppHostConfig(options: TestAppHostConfigOptions = {}) {
  return createAppHostConfig({
    apiBaseUrl: "http://localhost:3001",
    createSQLiteRuntime: () =>
      createSQLiteRuntime({
        workerConstructor: MockWorker,
      }),
    wsUrl: "ws://localhost:3002",
    ...options,
  });
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
  // The demo's panes are peers, so the split toggle reads as hiding/showing the
  // peer rather than a generic split/unsplit.
  const toggle = view.getByRole("button", { name: "Hide Peer" });
  fireEvent.click(toggle);
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
      view.getByText(/Generate a key pair to boot this pane\./),
    ).toBeTruthy();
    expect(
      view.getByRole("link", { name: "Home" }).getAttribute("aria-current"),
    ).toBe("page");

    // System actions live directly in the rail — no popover to open first.
    expect(
      view.getByRole("button", { name: "Restore Key Package" }),
    ).toBeTruthy();
    const generateKeyPairButton = view.getAllByRole("button", {
      name: "Generate Key Pair",
    })[1];
    if (!generateKeyPairButton) {
      throw new Error("Expected routed rail generate action.");
    }
    fireEvent.click(generateKeyPairButton);

    await waitFor(() => {
      const statusText = view.container.textContent ?? "";
      expect(statusText).toMatch(/sqlite worker:\s*ready/);
      expect(statusText).toMatch(/publicKey:\s*[0-9a-f]{64}/u);
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

    // Destroy Key Pair is also inline in the rail now that a key pair exists.
    expect(view.getByRole("button", { name: "Destroy Key Pair" })).toBeTruthy();

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
