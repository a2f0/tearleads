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
