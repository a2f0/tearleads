import { expect, mock, test } from "bun:test";
import { runScopedOrgMutation } from "./runScopedOrgMutation";

test("scoped org mutation owns current-scope busy and error state", async () => {
  const events: string[] = [];
  const logged: [string | Error, unknown][] = [];
  const logError = (message: string | Error, cause?: unknown) => {
    logged.push([message, cause]);
  };
  const setError = mock((error: string | null) =>
    events.push(`error:${error}`),
  );
  const setMutating = mock((mutating: boolean) =>
    events.push(`mutating:${mutating}`),
  );

  await runScopedOrgMutation({
    isOperationActive: () => true,
    logError,
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
  expect(logged).toEqual([]);

  events.length = 0;
  const failure = new Error("failed");
  await runScopedOrgMutation({
    isOperationActive: () => true,
    logError,
    operationOrganizationId: "org-1",
    run: async () => {
      throw failure;
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
  // The failure is reported with the original Error as the cause, so the
  // diagnostics adapter (the only path to Sentry) receives it.
  expect(logged).toEqual([["Organization mutation failed", failure]]);
});

test("scoped org mutation leaves stale or unavailable scopes untouched", async () => {
  let active = true;
  const logError = mock((_message: string | Error, _cause?: unknown) => {});
  const setError = mock((_error: string | null) => {});
  const setMutating = mock((_mutating: boolean) => {});

  await runScopedOrgMutation({
    isOperationActive: () => active,
    logError,
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
  // A stale scope's failure is not this panel's to report.
  expect(logError).not.toHaveBeenCalled();

  setError.mockClear();
  setMutating.mockClear();
  await runScopedOrgMutation({
    isOperationActive: () => false,
    logError,
    operationOrganizationId: "org-2",
    run: async () => {},
    setError,
    setMutating,
  });
  expect(setError).not.toHaveBeenCalled();
  expect(setMutating).not.toHaveBeenCalled();
});
