import { expect, test } from "bun:test";
import { render } from "@testing-library/react";
import {
  ExplorerFolderStatus,
  resolveExplorerFolderState,
} from "./ExplorerFolderStatus";

test("an empty local tree progresses from loading to syncing to a settled folder panel", () => {
  const local = {
    ready: true,
    count: 0,
    knownCount: 0,
    syncing: false,
    startupPending: false,
  };
  const state = (changes: Partial<typeof local>) =>
    resolveExplorerFolderState({ ...local, ...changes });
  const view = render(<ExplorerFolderStatus state={state({ ready: false })} />);
  expect(view.getByRole("status").textContent).toContain(
    "Loading your workspace",
  );
  view.rerender(<ExplorerFolderStatus state={state({ syncing: true })} />);
  expect(view.getByRole("status").textContent).toContain("Syncing folders");
  view.rerender(<ExplorerFolderStatus state={state({})} />);
  expect(view.queryByRole("status")).toBeNull();
  expect(
    view.getByRole("heading", { name: "No folders on this device" }),
  ).toBeTruthy();
  expect(state({ startupPending: true })).toBe("loading");
  expect(state({ knownCount: 1 })).toBe("unavailable");
  expect(state({ count: 1, syncing: true, startupPending: true })).toBe(
    "available",
  );
  view.unmount();
});
