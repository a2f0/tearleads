import { afterEach, expect, test } from "bun:test";
import { cleanup, renderHook } from "@testing-library/react";
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
