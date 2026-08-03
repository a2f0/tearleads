import { afterEach, expect, test } from "bun:test";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useSavedTrackerRows } from "./useSavedTrackerRows";

afterEach(cleanup);

const row = (id: string) => ({ id });

test("a targeted session keeps rows arriving later saved", () => {
  const view = renderHook(({ rows }) => useSavedTrackerRows(rows, "selected"), {
    initialProps: { rows: [row("selected"), row("sibling")] },
  });

  expect(view.result.current.isRowSaved("selected")).toBe(false);
  expect(view.result.current.isRowSaved("sibling")).toBe(true);
  const initialIsRowSaved = view.result.current.isRowSaved;

  view.rerender({
    rows: [row("selected"), row("sibling"), row("synced")],
  });

  expect(view.result.current.isRowSaved("synced")).toBe(true);
  expect(view.result.current.isRowSaved).toBe(initialIsRowSaved);
});

test("a full-document session keeps rows arriving later editable", () => {
  const view = renderHook(({ rows }) => useSavedTrackerRows(rows, null), {
    initialProps: { rows: [row("first")] },
  });

  view.rerender({ rows: [row("first"), row("synced")] });
  expect(view.result.current.isRowSaved("first")).toBe(false);
  expect(view.result.current.isRowSaved("synced")).toBe(false);

  act(() => view.result.current.setRowSaved("first", true));
  expect(view.result.current.isRowSaved("first")).toBe(true);
  expect(view.result.current.isRowSaved("synced")).toBe(false);
});

test("a missing target fails closed with every remaining row saved", () => {
  const view = renderHook(() =>
    useSavedTrackerRows([row("remaining")], "removed"),
  );

  expect(view.result.current.isRowSaved("remaining")).toBe(true);
});
