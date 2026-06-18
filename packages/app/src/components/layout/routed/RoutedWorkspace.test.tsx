import { afterEach, expect, mock, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import type { AppHostConfig } from "../../../host/AppHostConfig";

// Capture the host config RoutedWorkspace hands to PaneProvider without booting
// the real SDK/keyring/database stack. The mock renders nothing, so the heavy
// providers nested inside PaneProvider never mount.
const paneHostConfigs: AppHostConfig[] = [];
mock.module("../../pane/PaneProvider", () => ({
  PaneProvider: ({ hostConfig }: { hostConfig: AppHostConfig }) => {
    paneHostConfigs.push(hostConfig);
    return null;
  },
}));

// Imported after the mock is registered so RoutedWorkspace binds to the stub.
const { RoutedWorkspace } = await import("./RoutedWorkspace");
const { AppHostConfig: HostConfig } = await import(
  "../../../host/AppHostConfig"
);
const { WorkspaceProvider } = await import("../workspace/WorkspaceProvider");

afterEach(() => {
  cleanup();
  paneHostConfigs.length = 0;
});

test("scopes the pane host config namespace by the active workspace", () => {
  // Regression guard for the windowed -> routed login bug: routed mode must
  // resolve to the default windowed pane's namespace so the persisted session
  // survives the mode toggle. PaneProvider later appends `.left`, so the
  // workspace-scoped base is what we assert here. If RoutedWorkspace stops
  // scoping by workspace, this fails instead of silently logging the user out.
  const hostConfig = new HostConfig(
    "https://api.example.test",
    "wss://ws.example.test",
    undefined,
    undefined,
    "tearleads.app",
  );

  render(
    <WorkspaceProvider>
      <RoutedWorkspace hostConfig={hostConfig} navigationMode="routed" />
    </WorkspaceProvider>,
  );

  expect(paneHostConfigs).toHaveLength(1);
  expect(paneHostConfigs[0]?.localIdentityNamespace).toBe(
    "tearleads.app.workspace-1",
  );
});
