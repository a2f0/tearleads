import { expect, test } from "bun:test";
import { act, renderHook } from "@testing-library/react";
import { useSavedTrackerRows } from "./useSavedTrackerRows";

const row = (id: string) => ({ id });

test("a targeted session keeps rows arriving later saved", () => {
  const view = renderHook(({ rows }) => useSavedTrackerRows(rows, "selected"), {
    initialProps: { rows: [row("selected"), row("sibling")] },
  });

  expect([...view.result.current.savedRowIds]).toEqual(["sibling"]);

  view.rerender({
    rows: [row("selected"), row("sibling"), row("synced")],
  });

  expect([...view.result.current.savedRowIds]).toEqual(["sibling", "synced"]);
});

test("a full-document session keeps rows arriving later editable", () => {
  const view = renderHook(({ rows }) => useSavedTrackerRows(rows, null), {
    initialProps: { rows: [row("first")] },
  });

  view.rerender({ rows: [row("first"), row("synced")] });
  expect([...view.result.current.savedRowIds]).toEqual([]);

  act(() => view.result.current.setRowSaved("first", true));
  expect([...view.result.current.savedRowIds]).toEqual(["first"]);
});

test("a missing target falls back to a full-document session", () => {
  const view = renderHook(() =>
    useSavedTrackerRows([row("remaining")], "removed"),
  );

  expect([...view.result.current.savedRowIds]).toEqual([]);
});
