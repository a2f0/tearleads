import { afterEach, expect, test } from "bun:test";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { DocumentSummary } from "../../../data/documentSummary";
import { useSelectDocumentProjection } from "./useSelectedDocumentStructuralState";

afterEach(() => {
  cleanup();
});

function createDocumentSummary(
  overrides: Partial<DocumentSummary> = {},
): DocumentSummary {
  return {
    containerId: "source-container",
    documentId: "remote-document-1",
    id: "document-1",
    title: "Document 1",
    updatedAt: "2026-05-17T00:00:00.000Z",
    ...overrides,
  };
}

test("document projection selection updates immediately before async lookup", async () => {
  const selectedIds: Array<string | null> = [];
  const activationCalls: Array<{ containerId: string; noteId: string }> = [];
  let resolveDocument: ((value: DocumentSummary | null) => void) | undefined;
  const { result } = renderHook(() =>
    useSelectDocumentProjection({
      activateLinkedDocument: async (noteId, containerId) => {
        activationCalls.push({ containerId, noteId });
        return null;
      },
      loadDocumentSummary: async () =>
        new Promise<DocumentSummary | null>((resolve) => {
          resolveDocument = resolve;
        }),
      setSelectedId: (id) => {
        selectedIds.push(id);
      },
    }),
  );

  act(() => {
    result.current("document-1", "linked-container");
  });

  expect(selectedIds).toEqual(["document-1"]);
  expect(activationCalls).toEqual([]);

  resolveDocument?.(createDocumentSummary());

  await waitFor(() => {
    expect(activationCalls).toEqual([
      { containerId: "linked-container", noteId: "document-1" },
    ]);
  });
});
