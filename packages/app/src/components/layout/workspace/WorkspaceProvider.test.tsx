import { expect, test } from "bun:test";
import { fireEvent, render, waitFor } from "@testing-library/react";
import {
  localIdentityNamespaceForWorkspace,
  SINGLE_WORKSPACE_IDS,
  useWorkspace,
  WORKSPACE_IDS,
  WorkspaceProvider,
} from "./WorkspaceProvider";

function WorkspaceProbe() {
  const { activeWorkspace, setActiveWorkspace } = useWorkspace();
  return (
    <button type="button" onClick={() => setActiveWorkspace(2)}>
      {activeWorkspace}
    </button>
  );
}

test("scopes the base namespace by workspace id", () => {
  expect(localIdentityNamespaceForWorkspace("symcrypt.app", 1)).toBe(
    "symcrypt.app.workspace-1",
  );
  expect(localIdentityNamespaceForWorkspace("symcrypt.app", 2)).toBe(
    "symcrypt.app.workspace-2",
  );
});

test("falls back to the default base when none is provided", () => {
  expect(localIdentityNamespaceForWorkspace(undefined, 1)).toBe(
    "symcrypt.pane.workspace-1",
  );
});

test("resets the active workspace when the available ids shrink", async () => {
  const view = render(
    <WorkspaceProvider workspaceIds={WORKSPACE_IDS}>
      <WorkspaceProbe />
    </WorkspaceProvider>,
  );
  fireEvent.click(view.getByRole("button", { name: "1" }));
  expect(view.getByRole("button", { name: "2" })).toBeTruthy();

  view.rerender(
    <WorkspaceProvider workspaceIds={SINGLE_WORKSPACE_IDS}>
      <WorkspaceProbe />
    </WorkspaceProvider>,
  );
  await waitFor(() => {
    expect(view.getByRole("button", { name: "1" })).toBeTruthy();
  });
  view.unmount();
});
