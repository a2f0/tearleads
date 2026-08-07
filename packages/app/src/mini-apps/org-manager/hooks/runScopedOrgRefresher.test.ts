import { expect, mock, test } from "bun:test";
import { runScopedRefresher } from "../refresh";

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
  const onUnavailable = mock((_isCurrentRequest: () => boolean) => {});

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
