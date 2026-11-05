import { afterEach, expect, test } from "bun:test";
import { act, cleanup, renderHook } from "@testing-library/react";
import { StrictMode } from "react";
import { useStructuredDocumentEditing } from "./StructuredDocument";

afterEach(cleanup);

test("structured document editing starts read-only by default", () => {
  const { result } = renderHook(() => useStructuredDocumentEditing(true));

  expect(result.current[0]).toBe(false);
});

test("structured document editing can start editable for new documents", () => {
  const { result } = renderHook(() => useStructuredDocumentEditing(true, true));

  expect(result.current[0]).toBe(true);
});

test("initial edit mode waits until the document becomes writable", () => {
  const { result, rerender } = renderHook(
    ({ canWrite }) => useStructuredDocumentEditing(canWrite, true),
    { initialProps: { canWrite: false } },
  );

  expect(result.current[0]).toBe(false);

  rerender({ canWrite: true });

  expect(result.current[0]).toBe(true);
});

test("initial edit mode responds to new document signals after mount", () => {
  const { result, rerender } = renderHook(
    ({ initialEditing }) => useStructuredDocumentEditing(true, initialEditing),
    { initialProps: { initialEditing: false } },
  );

  expect(result.current[0]).toBe(false);

  rerender({ initialEditing: true });

  expect(result.current[0]).toBe(true);
});

test("editing exits when write access is lost", () => {
  const { result, rerender } = renderHook(
    ({ canWrite }) => useStructuredDocumentEditing(canWrite, true),
    { initialProps: { canWrite: true } },
  );

  expect(result.current[0]).toBe(true);

  rerender({ canWrite: false });

  expect(result.current[0]).toBe(false);
});

test("finishing an edit is not undone when write access returns", () => {
  // Regression: the initial edit request used to re-run on every write-access
  // change while the host still passed initialEditing, so a document the user
  // had finished editing reopened in edit mode after a write-access blip.
  const { result, rerender } = renderHook(
    ({ canWrite }) => useStructuredDocumentEditing(canWrite, true),
    { initialProps: { canWrite: true } },
  );

  act(() => result.current[2]());
  expect(result.current[0]).toBe(false);

  rerender({ canWrite: false });
  rerender({ canWrite: true });

  expect(result.current[0]).toBe(false);
});

test("toggling a read-only document does not enter edit mode", () => {
  // Regression: the toggle flipped isEditing without checking write access,
  // and nothing reset it until write access next changed.
  const { result } = renderHook(() => useStructuredDocumentEditing(false));

  act(() => result.current[2]());
  act(() => result.current[1]());

  expect(result.current[0]).toBe(false);
});

test("a waiting initial edit survives Strict Mode and the host consuming it", () => {
  const { result, rerender } = renderHook(
    ({ canWrite, initialEditing }) =>
      useStructuredDocumentEditing(canWrite, initialEditing),
    {
      initialProps: { canWrite: false, initialEditing: true },
      wrapper: StrictMode,
    },
  );

  expect(result.current[0]).toBe(false);

  // Explorer clears initialEditing once the document mounts, before write
  // access usually arrives.
  rerender({ canWrite: false, initialEditing: false });
  rerender({ canWrite: true, initialEditing: false });

  expect(result.current[0]).toBe(true);
});
