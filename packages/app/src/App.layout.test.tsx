import { afterEach, expect, test } from "bun:test";
import { createSQLiteRuntime } from "@tearleads/client-sdk/sqlite";
import {
  cleanup,
  fireEvent,
  render,
  waitFor,
  within,
} from "@testing-library/react";
import {
  createTestAppHostConfig,
  pinWindowedSystemMonitors,
} from "../test/helpers/appTestHostConfig";
import { MockWorker } from "../test/helpers/mockWorker";
import { enableSystemMonitorDeveloperMode } from "../test/helpers/systemMonitorTestPreferences";
import { App } from "./App";
import { APP_HOST_PROFILES } from "./host/AppHostConfig";
import { systemMonitorModeStorageKey } from "./mini-apps/system-monitor/systemMonitorMode";
import {
  appFeatureFlagStorageKey,
  saveAppFeatureFlag,
} from "./providers/feature-flags/appFeatureFlags";

const browser = window as typeof window & {
  happyDOM: { setURL: (url: string) => void };
};
const initialUrl = window.location.href;

afterEach(() => {
  cleanup();
  globalThis.localStorage.clear();
  browser.happyDOM.setURL(initialUrl);
});

function windowTitles(pane: Element | null): Array<string | null> {
  return [...(pane?.querySelectorAll(".window") ?? [])].map(
    (windowElement) =>
      windowElement.querySelector(".window-titlebar-title")?.textContent ??
      null,
  );
}

// A no-op WebSocket so the runtime's event socket never reaches the network in
// these full-app smoke tests (registration/sync run offline here).
class SilentWebSocket extends EventTarget {
  constructor(_url: string | URL) {
    super();
  }

  close() {}
}

test("normal App omits global chrome and keeps the lower layout switch", () => {
  enableSystemMonitorDeveloperMode();
  const view = render(<App hostConfig={createTestAppHostConfig()} />);

  const frame = view.container.querySelector(".tearleads-frame.layout");
  expect(frame?.classList.contains("layout--split")).toBe(false);
  // The regular app never splits, so there is no split/peer toggle in chrome.
  expect(view.queryByRole("button", { name: "Split" })).toBeNull();
  expect(view.queryByRole("button", { name: "Show Peer" })).toBeNull();
  expect(view.queryByRole("button", { name: /Navigation mode/i })).toBeNull();
  expect(view.container.querySelector(".tearleads-header")).toBeNull();
  expect(
    view.getByRole("button", { name: "Switch to iPad / mobile layout" }),
  ).toBeTruthy();
  expect(view.queryByText("Peer 1")).toBeNull();
  expect(view.queryByText("Peer 2")).toBeNull();
  expect(view.queryByRole("button", { name: "1" })).toBeNull();
  expect(view.queryByRole("button", { name: "2" })).toBeNull();
  view.unmount();
});

test("desktop App defaults to the tablet shell and can switch to windows", () => {
  const view = render(
    <App hostConfig={createTestAppHostConfig({ navigationMode: undefined })} />,
  );

  expect(view.container.querySelector(".layout--routed")).toBeTruthy();
  expect(
    view
      .getByRole("button", { name: /^Switch to .* theme$/ })
      .closest(".routed-pane-taskbar"),
  ).not.toBeNull();
  expect(view.container.querySelector(".window")).toBeNull();
  fireEvent.click(
    view.getByRole("button", { name: "Switch to windowed layout" }),
  );
  expect(view.container.querySelector(".layout--routed")).toBeNull();
  expect(
    view.getByRole("button", { name: "Switch to iPad / mobile layout" }),
  ).toBeTruthy();
  const pane = view.container.querySelector(".pane-left:not(.pane-hidden)");
  expect(pane?.querySelectorAll(".window").length).toBe(1);
  expect(pane?.querySelector(".window-titlebar-title")?.textContent).toBe(
    "Explorer",
  );
  expect(view.container.querySelectorAll(".pane-hidden .window")).toHaveLength(
    0,
  );
  view.unmount();
});

test("switching to windows opens the URL's app in front of Explorer", async () => {
  browser.happyDOM.setURL("http://localhost/app/system-monitor/status");
  const view = render(
    <App hostConfig={createTestAppHostConfig({ navigationMode: undefined })} />,
  );
  expect(view.container.querySelector(".window")).toBeNull();

  fireEvent.click(
    view.getByRole("button", { name: "Switch to windowed layout" }),
  );

  const pane = view.container.querySelector(".pane-left:not(.pane-hidden)");
  expect(windowTitles(pane)).toEqual(["Explorer", "System Monitor"]);
  const [explorer, monitor] = [
    ...(pane?.querySelectorAll<HTMLElement>(".window") ?? []),
  ];
  if (!explorer || !monitor) throw new Error("Expected two windows.");
  expect(Number(monitor.style.zIndex)).toBeGreaterThan(
    Number(explorer.style.zIndex),
  );
  const statusTab = await within(monitor).findByRole("tab", { name: "Status" });
  expect(statusTab.getAttribute("aria-selected")).toBe("true");
  expect(window.location.pathname).toBe("/app/system-monitor/status");
  view.unmount();
});

test("a pinned System Monitor answers its URL from the desktop", () => {
  browser.happyDOM.setURL("http://localhost/app/system-monitor");
  pinWindowedSystemMonitors();
  const view = render(<App hostConfig={createTestAppHostConfig()} />);

  const pane = view.container.querySelector(".pane-left:not(.pane-hidden)");
  expect(windowTitles(pane)).toEqual(["Explorer"]);
  expect(pane?.querySelector(".pane-content")).not.toBeNull();
  expect(
    globalThis.localStorage.getItem(systemMonitorModeStorageKey("left")),
  ).toBe("pinned");
  view.unmount();
});

test("only the workspace shown at the entry opens the URL's app", () => {
  browser.happyDOM.setURL("http://localhost/app/system-monitor");
  saveAppFeatureFlag(appFeatureFlagStorageKey("workspace-switcher"), "enabled");
  const view = render(<App hostConfig={createTestAppHostConfig()} />);
  const hiddenPane = view.container.querySelector<HTMLElement>(".pane-hidden");
  const visiblePane = view.container.querySelector<HTMLElement>(
    ".pane:not(.pane-hidden)",
  );
  if (!hiddenPane || !visiblePane)
    throw new Error("Expected two workspace panes.");
  expect(windowTitles(visiblePane)).toEqual(["Explorer", "System Monitor"]);
  expect(windowTitles(hiddenPane)).toEqual([]);
  fireEvent.click(within(visiblePane).getByRole("button", { name: "2" }));
  expect(windowTitles(hiddenPane)).toEqual(["Explorer"]);
  view.unmount();
});

test("hidden workspaces defer Explorer until shown", () => {
  saveAppFeatureFlag(appFeatureFlagStorageKey("workspace-switcher"), "enabled");
  const view = render(<App hostConfig={createTestAppHostConfig()} />);
  const hiddenPane = view.container.querySelector<HTMLElement>(".pane-hidden");
  const visiblePane = view.container.querySelector<HTMLElement>(
    ".pane:not(.pane-hidden)",
  );
  if (!hiddenPane || !visiblePane)
    throw new Error("Expected two workspace panes.");
  expect(hiddenPane.querySelectorAll(".window")).toHaveLength(0);
  expect(visiblePane.querySelectorAll(".window")).toHaveLength(1);
  fireEvent.click(within(visiblePane).getByRole("button", { name: "2" }));
  expect(hiddenPane.querySelectorAll(".window")).toHaveLength(1);
  expect(hiddenPane.querySelector(".window-titlebar-title")?.textContent).toBe(
    "Explorer",
  );
  fireEvent.click(
    within(hiddenPane).getByRole("button", { name: "Close window" }),
  );
  fireEvent.click(within(hiddenPane).getByRole("button", { name: "1" }));
  fireEvent.click(within(visiblePane).getByRole("button", { name: "2" }));
  expect(hiddenPane.querySelectorAll(".window")).toHaveLength(0);
  view.unmount();
});

test("mobile routed App omits the global frame header", () => {
  const originalMatchMedia = window.matchMedia;

  try {
    window.matchMedia = ((query: string) => ({
      addEventListener: () => {},
      addListener: () => {},
      dispatchEvent: () => false,
      matches: false,
      media: query,
      onchange: null,
      removeEventListener: () => {},
      removeListener: () => {},
    })) as unknown as typeof window.matchMedia;

    const view = render(
      <App
        hostConfig={createTestAppHostConfig({ navigationMode: "routed" })}
      />,
    );

    expect(view.container.querySelector(".tearleads-header")).toBeNull();
    expect(view.container.querySelector(".routed-pane-title")).toBeNull();
    view.unmount();
  } finally {
    window.matchMedia = originalMatchMedia;
  }
});

test("demo App starts split without global header controls", () => {
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
  // Each peer label rides in its own pane's taskbar, never under the windows.
  expect(
    view.getByText("Peer 1").closest(".pane-left .pane-footer"),
  ).not.toBeNull();
  expect(
    view.getByText("Peer 2").closest(".pane-right .pane-footer"),
  ).not.toBeNull();
  expect(view.container.querySelectorAll(".pane-left .window")).toHaveLength(1);
  expect(view.container.querySelectorAll(".pane-right .window")).toHaveLength(
    1,
  );
  expect(view.container.querySelector(".tearleads-header")).toBeNull();
  expect(view.queryByRole("button", { name: "Hide Peer" })).toBeNull();
  expect(view.queryByRole("button", { name: "Show Peer" })).toBeNull();
  view.unmount();
});

test("demo App defaults to its peer split on desktop", () => {
  const originalWidth = window.innerWidth;
  const originalMatchMedia = window.matchMedia;
  Reflect.set(window, "innerWidth", 1440);
  window.matchMedia = ((query: string) => ({
    addEventListener: () => {},
    addListener: () => {},
    dispatchEvent: () => false,
    matches: false,
    media: query,
    onchange: null,
    removeEventListener: () => {},
    removeListener: () => {},
  })) as unknown as typeof window.matchMedia;

  try {
    const view = render(
      <App
        hostConfig={createTestAppHostConfig({
          navigationMode: undefined,
          profile: APP_HOST_PROFILES.demo,
        })}
      />,
    );

    expect(
      view.container.querySelector(".layout--demo-peer-split"),
    ).toBeTruthy();
    view.unmount();
  } finally {
    Reflect.set(window, "innerWidth", originalWidth);
    window.matchMedia = originalMatchMedia;
  }
});

test("switching workspaces shares one identity database instead of booting a second", async () => {
  const originalWebSocket = globalThis.WebSocket;

  // The regular (shared-policy) app mounts both workspaces concurrently as two
  // views of the *same* user. A single runtime is hoisted above them, so the
  // workspace switcher only flips which view is visible — it must never boot a
  // second SQLite worker (the bug that gave each workspace its own identity).
  let runtimeCreations = 0;

  try {
    Reflect.set(globalThis, "WebSocket", SilentWebSocket);

    pinWindowedSystemMonitors();
    saveAppFeatureFlag(
      appFeatureFlagStorageKey("workspace-switcher"),
      "enabled",
    );
    const view = render(
      <App
        hostConfig={createTestAppHostConfig({
          autoProvisionIdentity: true,
          createSQLiteRuntime: () => {
            runtimeCreations += 1;
            return createSQLiteRuntime({ workerConstructor: MockWorker });
          },
        })}
      />,
    );

    await waitFor(() => {
      expect(view.container.textContent ?? "").toMatch(
        /sqlite worker:?\s*ready/i,
      );
    });
    expect(runtimeCreations).toBe(1);

    // Both workspace views are mounted concurrently, so each pane footer carries
    // its own switcher — pick the first to drive the switch.
    const clickWorkspaceButton = (name: string) => {
      const button = view.getAllByRole("button", { name })[0];
      if (!button) {
        throw new Error(`Expected a workspace "${name}" switcher button.`);
      }
      fireEvent.click(button);
    };

    // Switch to workspace 2: a second view on the same runtime, not a reboot.
    clickWorkspaceButton("2");

    await waitFor(() => {
      expect(view.container.textContent ?? "").toMatch(
        /sqlite worker:?\s*ready/i,
      );
    });
    expect(runtimeCreations).toBe(1);

    // Switch back to workspace 1: still the same single runtime.
    clickWorkspaceButton("1");

    await waitFor(() => {
      expect(view.container.textContent ?? "").toMatch(
        /sqlite worker:?\s*ready/i,
      );
    });
    expect(runtimeCreations).toBe(1);

    view.unmount();
  } finally {
    Reflect.set(globalThis, "WebSocket", originalWebSocket);
  }
});

test("the shared runtime persists the local identity under a stable namespace", async () => {
  // Regression: the shared-policy runtime is hoisted above the workspaces
  // (WorkspaceRuntimeHost) with the root host config, whose
  // localIdentityNamespace is undefined. With no namespace,
  // useLocalIdentityPersistence returns null, so the identity is never persisted
  // and cannot survive a reload — the failure the e2e "SQLite tables survive a
  // hard reload" / "same persisted identity can boot in two tabs" tests caught.
  // The shared runtime must fall back to a stable namespace; this pins that
  // without needing the browser.
  const originalWebSocket = globalThis.WebSocket;

  // LOCAL_IDENTITY_REGISTRY_STORAGE_PREFIX + the shared namespace (see
  // localIdentityPersistence.ts and Layout's
  // SHARED_RUNTIME_LOCAL_IDENTITY_NAMESPACE).
  const sharedIdentityStorageKey =
    "tearleads.local-identity-registry:tearleads.app";

  try {
    Reflect.set(globalThis, "WebSocket", SilentWebSocket);

    pinWindowedSystemMonitors();
    const view = render(
      <App
        hostConfig={createTestAppHostConfig({ autoProvisionIdentity: true })}
      />,
    );

    await waitFor(() => {
      expect(view.container.textContent ?? "").toMatch(
        /sqlite worker:?\s*ready/i,
      );
    });

    // The autopilot generates an identity and persists its key package under the
    // shared namespace. Without the namespace fix this key is never written.
    await waitFor(
      () => {
        expect(
          globalThis.localStorage.getItem(sharedIdentityStorageKey),
        ).not.toBeNull();
      },
      { timeout: 5_000 },
    );

    view.unmount();
  } finally {
    Reflect.set(globalThis, "WebSocket", originalWebSocket);
  }
}, 10_000);
