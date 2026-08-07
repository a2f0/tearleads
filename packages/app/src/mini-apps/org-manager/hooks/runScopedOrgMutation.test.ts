import { expect, mock, test } from "bun:test";
import { runScopedOrgMutation } from "./runScopedOrgMutation";

test("scoped org mutation owns current-scope busy and error state", async () => {
  const events: string[] = [];
  const setError = mock((error: string | null) =>
    events.push(`error:${error}`),
  );
  const setMutating = mock((mutating: boolean) =>
    events.push(`mutating:${mutating}`),
  );

  await runScopedOrgMutation({
    isOperationActive: () => true,
    operationOrganizationId: "org-1",
    run: async () => {
      events.push("run");
    },
    setError,
    setMutating,
  });
  expect(events).toEqual([
    "mutating:true",
    "error:null",
    "run",
    "mutating:false",
  ]);

  events.length = 0;
  await runScopedOrgMutation({
    isOperationActive: () => true,
    operationOrganizationId: "org-1",
    run: async () => {
      throw new Error("failed");
    },
    setError,
    setMutating,
  });
  expect(events).toEqual([
    "mutating:true",
    "error:null",
    "error:failed",
    "mutating:false",
  ]);
});

test("scoped org mutation leaves stale or unavailable scopes untouched", async () => {
  let active = true;
  const setError = mock((_error: string | null) => {});
  const setMutating = mock((_mutating: boolean) => {});

  await runScopedOrgMutation({
    isOperationActive: () => active,
    operationOrganizationId: "org-1",
    run: async () => {
      active = false;
      throw new Error("stale");
    },
    setError,
    setMutating,
  });
  expect(setError).toHaveBeenCalledTimes(1);
  expect(setMutating).toHaveBeenCalledTimes(1);

  setError.mockClear();
  setMutating.mockClear();
  await runScopedOrgMutation({
    isOperationActive: () => false,
    operationOrganizationId: "org-2",
    run: async () => {},
    setError,
    setMutating,
  });
  expect(setError).not.toHaveBeenCalled();
  expect(setMutating).not.toHaveBeenCalled();
});
