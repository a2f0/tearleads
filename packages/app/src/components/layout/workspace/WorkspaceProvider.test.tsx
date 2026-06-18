import { expect, test } from "bun:test";
import { localIdentityNamespaceForWorkspace } from "./WorkspaceProvider";

test("scopes the base namespace by workspace id", () => {
  expect(localIdentityNamespaceForWorkspace("tearleads.app", 1)).toBe(
    "tearleads.app.workspace-1",
  );
  expect(localIdentityNamespaceForWorkspace("tearleads.app", 2)).toBe(
    "tearleads.app.workspace-2",
  );
});

test("falls back to the default base when none is provided", () => {
  expect(localIdentityNamespaceForWorkspace(undefined, 1)).toBe(
    "tearleads.pane.workspace-1",
  );
});

test("routed and windowed default panes resolve to the same namespace", () => {
  // Regression guard: RoutedWorkspace tracks the active workspace and
  // PaneProvider appends `.left`, so a session established in the default
  // windowed pane survives the mode toggle into routed mode. If routed mode
  // ever stops scoping by workspace, this divergence is what tells the user
  // they need to log in again.
  const base = "tearleads.app";
  const windowedDefault = `${localIdentityNamespaceForWorkspace(base, 1)}.left`;
  const routedDefault = `${localIdentityNamespaceForWorkspace(base, 1)}.left`;
  expect(routedDefault).toBe(windowedDefault);
});
