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

test("returning to a scope re-pends what that scope had settled", () => {
  // Settlements are stamped with the scope that produced them: coming back to
  // organization A must not reuse A's old settlement, because A's state has
  // been recreated as null and its fetch is only just starting.
  const view = renderPendingState();
  act(() => view.result.current.markDataUsageSettled());
  act(() => view.result.current.markDirectorySettled());

  const scopeB = {
    databaseStarting: false,
    loading: false,
    scopeKey: "scope-b",
    selectedGroupId: null,
  };
  view.rerender(scopeB);
  act(() => view.result.current.markDirectorySettled());
  view.rerender({ ...scopeB, scopeKey: "scope-a" });

  expect(view.result.current.dataPending).toBe(true);
  expect(view.result.current.dataUsagePending).toBe(true);
});

test("grants and org policy history each settle on their own pass", () => {
  // Both run their own managed refresh on view entry, so neither can ride on the
  // directory's settlement.
  const view = renderPendingState();
  act(() => view.result.current.markDirectorySettled());

  expect(view.result.current.dataPending).toBe(false);
  expect(view.result.current.grantsPending).toBe(true);
  expect(view.result.current.organizationPolicyHistoryPending).toBe(true);

  act(() => view.result.current.markGrantsSettled());
  act(() => view.result.current.markOrganizationPolicyHistorySettled());

  expect(view.result.current.grantsPending).toBe(false);
  expect(view.result.current.organizationPolicyHistoryPending).toBe(false);
});

test("an abandoned intermediate scope cannot revive prior settlements", () => {
  // A -> B -> A before B fetches anything: A's projections were cleared on the
  // A->B switch, so returning to A must not resurrect A's old settlement.
  const view = renderPendingState();
  act(() => view.result.current.markDataUsageSettled());
  act(() => view.result.current.markDirectorySettled());

  const at = (scopeKey: string) => ({
    databaseStarting: false,
    loading: false,
    scopeKey,
    selectedGroupId: null,
  });
  view.rerender(at("scope-b"));
  view.rerender(at("scope-a"));

  expect(view.result.current.dataPending).toBe(true);
  expect(view.result.current.dataUsagePending).toBe(true);
});
