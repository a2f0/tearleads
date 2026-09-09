import { afterEach, expect, test } from "bun:test";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useDocumentDraft } from "./useDocumentDraft";

afterEach(cleanup);

test("draft IDs survive rerenders and rotate with the owning runtime or container", () => {
  const scope = {};
  const view = renderHook((props) => useDocumentDraft(props), {
    initialProps: { containerId: "first-container", scope },
  });
  const original = view.result.current.draft.id;
  view.rerender({ containerId: "first-container", scope });
  expect(view.result.current.draft.id).toBe(original);
  view.rerender({ containerId: "second-container", scope });
  const moved = view.result.current.draft.id;
  expect(moved).not.toBe(original);
  expect(view.result.current.draft.containerId).toBe("second-container");
  view.rerender({ containerId: "second-container", scope: {} });
  expect(view.result.current.draft.id).not.toBe(moved);
});

test("replacing the last draft keeps the fresh selection stable", () => {
  const view = renderHook(() => useDocumentDraft());
  const original = view.result.current.draft.id;
  let nextId = original;
  act(() => {
    nextId = view.result.current.resetDraft().id;
  });
  expect(nextId).not.toBe(original);
  expect(view.result.current.draft.id).toBe(nextId);
  view.rerender();
  expect(view.result.current.draft.id).toBe(nextId);
});
