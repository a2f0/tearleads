import { afterEach, expect, test } from "bun:test";
import type { DocumentSummary } from "@tearleads/client-sdk";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
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
  const selectedDocuments: Array<{ containerId: string; id: string }> = [];
  const selectedIds: Array<string | null> = [];
  const activationCalls: Array<{ containerId: string; documentId: string }> =
    [];
  let resolveDocument: ((value: DocumentSummary | null) => void) | undefined;
  const { result } = renderHook(() =>
    useSelectDocumentProjection({
      activateLinkedDocument: async (documentId, containerId) => {
        activationCalls.push({ containerId, documentId });
        return createDocumentSummary({ containerId });
      },
      loadDocumentSummary: async () =>
        new Promise<DocumentSummary | null>((resolve) => {
          resolveDocument = resolve;
        }),
      selectDocument: (id, containerId) => {
        selectedDocuments.push({ containerId, id });
      },
      setSelectedId: (id) => {
        selectedIds.push(id);
      },
    }),
  );

  act(() => {
    result.current("document-1", "linked-container");
  });

  expect(selectedDocuments).toEqual([
    { containerId: "linked-container", id: "document-1" },
  ]);
  expect(selectedIds).toEqual([]);
  expect(activationCalls).toEqual([]);

  resolveDocument?.(createDocumentSummary());

  await waitFor(() => {
    expect(activationCalls).toEqual([
      { containerId: "linked-container", documentId: "document-1" },
    ]);
  });
});

test("document projection selection ignores superseded async lookups", async () => {
  const selectedDocuments: Array<{ containerId: string; id: string }> = [];
  const selectedIds: Array<string | null> = [];
  const pendingLoads = new Map<
    string,
    (value: DocumentSummary | null) => void
  >();
  const { result } = renderHook(() =>
    useSelectDocumentProjection({
      activateLinkedDocument: async () => null,
      loadDocumentSummary: async (localId) =>
        new Promise<DocumentSummary | null>((resolve) => {
          pendingLoads.set(localId, resolve);
        }),
      selectDocument: (id, containerId) => {
        selectedDocuments.push({ containerId, id });
      },
      setSelectedId: (id) => {
        selectedIds.push(id);
      },
    }),
  );

  act(() => {
    result.current("document-1", "first-container");
    result.current("document-2", "second-container");
  });

  await act(async () => {
    pendingLoads.get("document-2")?.(
      createDocumentSummary({
        containerId: "second-container",
        id: "document-2",
      }),
    );
    await Promise.resolve();
  });
  await act(async () => {
    pendingLoads.get("document-1")?.(null);
    await Promise.resolve();
  });

  expect(selectedDocuments).toEqual([
    { containerId: "first-container", id: "document-1" },
    { containerId: "second-container", id: "document-2" },
  ]);
  expect(selectedIds).toEqual([]);
});
