import { afterEach, expect, test } from "bun:test";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useOrgManagerPendingState } from "./useOrgManagerPendingState";

afterEach(cleanup);

function renderPendingState(
  overrides: Partial<Parameters<typeof useOrgManagerPendingState>[0]> = {},
) {
  return renderHook(
    (props: Parameters<typeof useOrgManagerPendingState>[0]) =>
      useOrgManagerPendingState(props),
    {
      initialProps: {
        databaseStarting: false,
        loading: false,
        scopeKey: "scope-a",
        selectedGroupId: null,
        ...overrides,
      },
    },
  );
}

test("data is pending until the directory settles for this scope", () => {
  const view = renderPendingState();

  expect(view.result.current.dataPending).toBe(true);

  act(() => view.result.current.markDirectorySettled());

  expect(view.result.current.dataPending).toBe(false);
});

test("a starting database keeps data pending even once settled", () => {
  const view = renderPendingState();
  act(() => view.result.current.markDirectorySettled());

  view.rerender({
    databaseStarting: true,
    loading: false,
    scopeKey: "scope-a",
    selectedGroupId: null,
  });

  expect(view.result.current.dataPending).toBe(true);
});

test("a terminal database failure settles rather than spinning forever", () => {
  // `error`/`terminated` never become ready. Treating them as pending would
  // leave the views on "Loading..." for good, hiding the real failure.
  const view = renderPendingState({ databaseStarting: false });
  act(() => view.result.current.markDirectorySettled());

  expect(view.result.current.dataPending).toBe(false);
});

test("switching scope reads as pending immediately, with no reset effect", () => {
  // The scope-switch flash this replaces came from a boolean that stayed true
  // until an effect cleared it, so the first render of the new organization
  // still claimed to be settled and painted the unavailable copy.
  const view = renderPendingState();
  act(() => view.result.current.markDirectorySettled());

  view.rerender({
    databaseStarting: false,
    loading: false,
    scopeKey: "scope-b",
    selectedGroupId: null,
  });

  expect(view.result.current.dataPending).toBe(true);
});

test("a selected group is pending until its own details settle", () => {
  // Group details run with no loading flag at all, so the directory's
  // settlement says nothing about whether this group has been fetched.
  const view = renderPendingState({ selectedGroupId: "group-1" });
  act(() => view.result.current.markDirectorySettled());

  expect(view.result.current.dataPending).toBe(false);
  expect(view.result.current.groupDetailsPending).toBe(true);

  act(() => view.result.current.markGroupDetailsSettled("group-1"));

  expect(view.result.current.groupDetailsPending).toBe(false);

  view.rerender({
    databaseStarting: false,
    loading: false,
    scopeKey: "scope-a",
    selectedGroupId: "group-2",
  });

  expect(view.result.current.groupDetailsPending).toBe(true);
});

test("no selected group has nothing outstanding to wait for", () => {
  const view = renderPendingState();
  act(() => view.result.current.markDirectorySettled());

  expect(view.result.current.groupDetailsPending).toBe(false);
});

test("usage settles on its own, not on the directory's pass", () => {
  // Entering Usage refreshes with `manageLoading: false`, so neither `loading`
  // nor the directory's settlement says anything about that fetch.
  const view = renderPendingState();
  act(() => view.result.current.markDirectorySettled());

  expect(view.result.current.dataPending).toBe(false);
  expect(view.result.current.dataUsagePending).toBe(true);

  act(() => view.result.current.markDataUsageSettled());

  expect(view.result.current.dataUsagePending).toBe(false);
});

test("a scope cycle re-pends the same selected group", () => {
  // A database ready -> idle -> ready cycle re-keys the runtime scope and clears
  // the group's details, so the previously settled group id must not still read
  // as fetched.
  const view = renderPendingState({ selectedGroupId: "group-1" });
  act(() => view.result.current.markGroupDetailsSettled("group-1"));

  expect(view.result.current.groupDetailsPending).toBe(false);

  view.rerender({
    databaseStarting: false,
    loading: false,
    scopeKey: "scope-b",
    selectedGroupId: "group-1",
  });

  expect(view.result.current.groupDetailsPending).toBe(true);
});
