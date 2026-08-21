import { afterEach, expect, test } from "bun:test";
import { DEFAULT_DOCUMENT_KIND } from "@symcrypt/client-sdk";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useInitialDocumentEditing } from "./useInitialDocumentEditing";

afterEach(cleanup);

test("a created structured document starts in edit mode until consumed", () => {
  const { result } = renderHook(() => useInitialDocumentEditing());

  expect(result.current.documentStartsInEditMode("doc-1")).toBe(false);

  act(() => {
    result.current.trackCreatedDocument("doc-1", "drivers_license");
  });
  expect(result.current.documentStartsInEditMode("doc-1")).toBe(true);

  act(() => {
    result.current.consumeInitialDocumentEditing("doc-1");
  });
  expect(result.current.documentStartsInEditMode("doc-1")).toBe(false);
});

test("a created plain note never starts in edit mode", () => {
  const { result } = renderHook(() => useInitialDocumentEditing());

  act(() => {
    result.current.trackCreatedDocument("note-1", DEFAULT_DOCUMENT_KIND);
  });

  expect(result.current.documentStartsInEditMode("note-1")).toBe(false);
});

test("returning from the blob picker re-arms edit mode across remounts", () => {
  const { result } = renderHook(() => useInitialDocumentEditing());

  // Simulates the "Choose Blob" round-trip: mark the document so its remount
  // comes back in edit mode.
  act(() => {
    result.current.markDocumentStartsInEditMode("doc-1");
  });
  expect(result.current.documentStartsInEditMode("doc-1")).toBe(true);

  // The detail panel consumes the flag once the document has mounted...
  act(() => {
    result.current.consumeInitialDocumentEditing("doc-1");
  });
  expect(result.current.documentStartsInEditMode("doc-1")).toBe(false);

  // ...and a second pick round-trip re-arms it again.
  act(() => {
    result.current.markDocumentStartsInEditMode("doc-1");
  });
  expect(result.current.documentStartsInEditMode("doc-1")).toBe(true);
});

test("an absent selection never starts in edit mode", () => {
  const { result } = renderHook(() => useInitialDocumentEditing());

  expect(result.current.documentStartsInEditMode(undefined)).toBe(false);
});
