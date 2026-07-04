import { afterEach, expect, test } from "bun:test";
import { createSQLiteRuntime } from "@tearleads/client-sdk/sqlite";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import {
  createTestAppHostConfig,
  pinWindowedSystemMonitors,
} from "../test/helpers/appTestHostConfig";
import { MockWorker } from "../test/helpers/mockWorker";
import { App } from "./App";
import { APP_HOST_PROFILES } from "./host/AppHostConfig";

afterEach(() => {
  cleanup();
  globalThis.localStorage.clear();
});

// A no-op WebSocket so the runtime's event socket never reaches the network in
// these full-app smoke tests (registration/sync run offline here).
class SilentWebSocket extends EventTarget {
  constructor(_url: string | URL) {
    super();
  }

  close() {}
}

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

  // LOCAL_IDENTITY_PACKAGE_STORAGE_PREFIX + the shared namespace (see
  // localIdentityPersistence.ts and Layout's
  // SHARED_RUNTIME_LOCAL_IDENTITY_NAMESPACE).
  const sharedIdentityStorageKey =
    "tearleads.local-identity-key-package:tearleads.app";

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
});
