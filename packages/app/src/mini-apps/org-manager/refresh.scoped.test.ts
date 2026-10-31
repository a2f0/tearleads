import { expect, mock, test } from "bun:test";
import { loadAfterOptionalMutation, runScopedRefresher } from "./refresh";

test("scoped refresher applies and settles only the current request", async () => {
  const events: string[] = [];
  let current = true;
  const apply = mock((value: string) => events.push(`apply:${value}`));
  const setError = mock((error: string | null) =>
    events.push(`error:${error}`),
  );
  const setLoading = mock((loading: boolean) =>
    events.push(`loading:${loading}`),
  );
  const onSettled = mock(() => events.push("settled"));

  await runScopedRefresher({
    apply,
    beginRequest: () => () => current,
    load: async () => {
      events.push("load");
      return "value";
    },
    onSettled,
    requestKind: "grants",
    setError,
    setLoading,
  });

  expect(events).toEqual([
    "loading:true",
    "error:null",
    "load",
    "apply:value",
    "loading:false",
    "settled",
  ]);

  events.length = 0;
  current = true;
  await runScopedRefresher({
    apply,
    beginRequest: () => () => current,
    load: async () => {
      current = false;
      return "stale";
    },
    onSettled,
    requestKind: "grants",
    setError,
    setLoading,
  });
  expect(events).toEqual(["loading:true", "error:null"]);
  expect(apply).toHaveBeenCalledTimes(1);
  expect(onSettled).toHaveBeenCalledTimes(1);
});

test("scoped refresher contains current errors and skips unavailable work", async () => {
  const setError = mock((_error: string | null) => {});
  const onUnavailable = mock(() => {});

  await runScopedRefresher({
    apply: () => {},
    beginRequest: () => () => true,
    load: async () => {
      throw new Error("failed");
    },
    requestKind: "userDetail",
    setError,
  });
  expect(setError).toHaveBeenNthCalledWith(1, null);
  expect(setError).toHaveBeenNthCalledWith(2, "failed");

  setError.mockClear();
  await runScopedRefresher({
    apply: () => {},
    beginRequest: () => () => true,
    load: null,
    onUnavailable,
    requestKind: "userDetail",
    setError,
  });
  expect(onUnavailable).toHaveBeenCalledTimes(1);
  expect(setError).not.toHaveBeenCalled();
});

test("a mutation's own post-commit read model replaces the second read", async () => {
  const loads: string[] = [];
  const actions = {
    loadDirectoryAndGroups: mock(async () => {
      loads.push("reconcile");
      return null;
    }),
    loadDirectoryAndGroupsAfterMutation: mock(async () => {
      loads.push("after-mutation");
      return null;
    }),
  };
  const result = (directoryAndGroups: null) => ({
    directoryAndGroups,
    receipt: {} as never,
  });

  // A purged projection (null) is still the mutation's answer: no re-read.
  await expect(
    loadAfterOptionalMutation(actions, {
      afterMutation: true,
      mutationResult: result(null),
    }),
  ).resolves.toBeNull();
  expect(loads).toEqual([]);
  // A declined reconcile (offline), no result, or a plain refresh reads.
  await loadAfterOptionalMutation(actions, {
    afterMutation: true,
    mutationResult: { directoryAndGroups: undefined, receipt: {} as never },
  });
  await loadAfterOptionalMutation(actions, { afterMutation: true });
  await loadAfterOptionalMutation(actions, { mutationResult: result(null) });
  expect(loads).toEqual(["after-mutation", "after-mutation", "reconcile"]);
});
