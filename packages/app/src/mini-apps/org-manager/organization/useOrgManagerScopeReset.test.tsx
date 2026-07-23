import { afterEach, expect, test } from "bun:test";
import { cleanup, renderHook } from "@testing-library/react";
import { useOrgManagerScopeReset } from "./useOrgManagerScopeReset";

afterEach(() => cleanup());

function createScopeResetHarness() {
  const calls: string[] = [];
  const record = (name: string) => () => {
    calls.push(name);
  };
  const view = renderHook(
    ({ scopeKey }: { readonly scopeKey: string }) =>
      useOrgManagerScopeReset({
        closeContextMenu: record("closeContextMenu"),
        resetDirectoryState: record("resetDirectoryState"),
        scopeKey,
        setDirectorySettled: record("setDirectorySettled"),
        setError: record("setError"),
        setGrants: record("setGrants"),
        setLoading: record("setLoading"),
        setLoadingUserDetail: record("setLoadingUserDetail"),
        setMutating: record("setMutating"),
        setOrganizationPolicyHistory: record("setOrganizationPolicyHistory"),
      }),
    { initialProps: { scopeKey: "scope-a" } },
  );
  return { calls, view };
}

test("a scope change releases busy flags an abandoned refresh left set", () => {
  const { calls, view } = createScopeResetHarness();
  expect(calls).toEqual([]);

  view.rerender({ scopeKey: "scope-b" });

  expect(calls).toContain("setLoading");
  expect(calls).toContain("setLoadingUserDetail");
  expect(calls).toContain("setMutating");
  expect(calls).toContain("resetDirectoryState");
  // The new scope has not been fetched yet, so its views must read as pending
  // rather than reporting the previous scope's settled emptiness.
  expect(calls).toContain("setDirectorySettled");
});

test("an unchanged scope never resets view state", () => {
  const { calls, view } = createScopeResetHarness();
  view.rerender({ scopeKey: "scope-a" });
  expect(calls).toEqual([]);
});
