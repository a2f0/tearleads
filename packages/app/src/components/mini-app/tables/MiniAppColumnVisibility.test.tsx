import { afterEach, expect, test } from "bun:test";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { useMiniAppColumnVisibility } from "./MiniAppColumnVisibility";

type TestColumnId = "created" | "modified";

const TEST_TOGGLEABLE_COLUMN_IDS: ReadonlyArray<TestColumnId> = [
  "created",
  "modified",
];

afterEach(() => {
  cleanup();
  globalThis.localStorage.clear();
});

function hiddenColumnIds(value: ReadonlySet<TestColumnId>) {
  return [...value].sort();
}

test("column visibility reloads preferences when the storage key changes", async () => {
  globalThis.localStorage.setItem(
    "mini-app-columns:first",
    JSON.stringify(["created"]),
  );

  const view = renderHook(
    ({ storageKey }: { storageKey: string }) =>
      useMiniAppColumnVisibility<TestColumnId>({
        defaultHiddenColumnIds: ["modified"],
        storageKey,
        toggleableColumnIds: TEST_TOGGLEABLE_COLUMN_IDS,
      }),
    { initialProps: { storageKey: "mini-app-columns:first" } },
  );

  expect(hiddenColumnIds(view.result.current.hiddenColumns)).toEqual([
    "created",
  ]);

  view.rerender({ storageKey: "mini-app-columns:second" });

  await waitFor(() => {
    expect(hiddenColumnIds(view.result.current.hiddenColumns)).toEqual([
      "modified",
    ]);
  });
  expect(globalThis.localStorage.getItem("mini-app-columns:second")).toBe(
    JSON.stringify(["modified"]),
  );
});
