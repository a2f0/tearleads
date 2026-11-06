import { afterEach, expect, test } from "bun:test";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useOrgManagerDialogs } from "./useOrgManagerDialogs";

afterEach(() => cleanup());

function renderDialogs(initial: { mutating: boolean } = { mutating: false }) {
  const calls: string[] = [];
  const view = renderHook(
    ({ mutating }: { readonly mutating: boolean }) =>
      useOrgManagerDialogs({
        canCreateGroup: true,
        canImportRosterUser: true,
        mutating,
        selectGroup: (groupId) => calls.push(`selectGroup:${groupId}`),
        setError: (error) => calls.push(`setError:${error}`),
        setOrgManagerView: (next) => calls.push(`setOrgManagerView:${next}`),
        setView: (next) => calls.push(`setView:${next}`),
      }),
    { initialProps: initial },
  );
  return { calls, view };
}

test("opening one dialog closes the other, which cannot come back", () => {
  const { view } = renderDialogs();
  act(() => view.result.current.openImportUserDialog());
  act(() => view.result.current.setImportUserIdDraft("stale link"));
  // The window File menu still offers "New group" over the import dialog.
  act(() => view.result.current.openCreateGroupDialog());

  expect(view.result.current.isCreateGroupDialogOpen).toBe(true);
  expect(view.result.current.isImportUserDialogOpen).toBe(false);

  act(() => view.result.current.closeCreateGroupDialog());

  expect(view.result.current.isImportUserDialogOpen).toBe(false);
  expect(view.result.current.importUserIdDraft).toBe("");
});

test("opening a dialog clears the error, selection and draft", () => {
  const { calls, view } = renderDialogs();
  act(() => view.result.current.openCreateGroupDialog());
  act(() => view.result.current.setGroupNameDraft("Ops"));
  act(() => view.result.current.openCreateGroupDialog());

  expect(view.result.current.groupNameDraft).toBe("");
  act(() => view.result.current.openImportUserDialog());
  expect(calls).toEqual([
    "setError:null",
    "selectGroup:null",
    "setView:groups",
    "setError:null",
    "selectGroup:null",
    "setView:groups",
    "setError:null",
    "setOrgManagerView:directory",
  ]);
});

test("a dialog stays open while its mutation runs", () => {
  const { view } = renderDialogs({ mutating: true });
  act(() => view.result.current.openImportUserDialog());
  act(() => view.result.current.setImportUserIdDraft("link"));
  act(() => view.result.current.closeImportUserDialog());

  expect(view.result.current.isImportUserDialogOpen).toBe(true);
  expect(view.result.current.importUserIdDraft).toBe("link");

  view.rerender({ mutating: false });
  act(() => view.result.current.closeImportUserDialog());

  expect(view.result.current.isImportUserDialogOpen).toBe(false);
  expect(view.result.current.importUserIdDraft).toBe("");
});
