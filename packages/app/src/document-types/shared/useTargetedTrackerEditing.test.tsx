import { afterEach, expect, test } from "bun:test";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { useTargetedTrackerEditing } from "./useTargetedTrackerEditing";

afterEach(cleanup);

test("row and toolbar actions enter the intended edit modes", () => {
  const view = renderHook(() => useTargetedTrackerEditing(true));

  act(() => view.result.current.enterRowEdit?.("row-2"));
  expect(view.result.current.isEditing).toBe(true);
  expect(view.result.current.editingRowId).toBe("row-2");

  act(() => view.result.current.toggleEditing());
  expect(view.result.current.isEditing).toBe(false);
  expect(view.result.current.editingRowId).toBeNull();

  act(() => view.result.current.toggleEditing());
  expect(view.result.current.isEditing).toBe(true);
  expect(view.result.current.editingRowId).toBeNull();
});

test("losing write access clears a targeted edit", async () => {
  const view = renderHook(
    ({ canWrite }) => useTargetedTrackerEditing(canWrite),
    { initialProps: { canWrite: true } },
  );

  act(() => view.result.current.enterRowEdit?.("row-1"));
  view.rerender({ canWrite: false });

  await waitFor(() => {
    expect(view.result.current.isEditing).toBe(false);
    expect(view.result.current.editingRowId).toBeNull();
    expect(view.result.current.enterRowEdit).toBeUndefined();
  });
});
