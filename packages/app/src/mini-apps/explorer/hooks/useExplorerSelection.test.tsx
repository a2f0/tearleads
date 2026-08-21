import { afterEach, expect, test } from "bun:test";
import type { ContainerNode, DocumentSummary } from "@symcrypt/client-sdk";
import { syncedContainerDocumentObjectSyncState } from "@symcrypt/client-sdk";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import {
  createExplorerOrphanedDocumentsNode,
  EXPLORER_ORPHANED_DOCUMENTS_ID,
} from "../../../stores/explorer/orphanedDocuments";
import { useExplorerSelection } from "./useExplorerSelection";

afterEach(() => {
  cleanup();
});

const nodes: ContainerNode[] = [
  {
    id: "root-container",
    kind: "container",
    name: "Root",
    organizationId: "org-1",
    parentId: null,
    syncState: syncedContainerDocumentObjectSyncState,
  },
];

function createDocumentSummary(
  overrides: Partial<DocumentSummary> = {},
): DocumentSummary {
  return {
    containerId: "root-container",
    documentId: "remote-document-1",
    id: "document-1",
    title: "Document 1",
    updatedAt: "2026-05-17T00:00:00.000Z",
    ...overrides,
  };
}

test("pending document selection remains active until the summary loads", async () => {
  const initialProps: { documents: ReadonlyArray<DocumentSummary> } = {
    documents: [],
  };
  const view = renderHook(
    ({ documents }: { documents: ReadonlyArray<DocumentSummary> }) =>
      useExplorerSelection(nodes, documents),
    { initialProps },
  );

  await waitFor(() => {
    expect(view.result.current.selectedId).toBe("root-container");
  });

  act(() => {
    view.result.current.selectDocument("document-1", "root-container");
  });

  expect(view.result.current.selectedId).toBe("document-1");
  expect(view.result.current.activeContainerId).toBe("root-container");
  expect(view.result.current.selectedDocument).toBeUndefined();

  view.rerender({ documents: [createDocumentSummary()] });

  await waitFor(() => {
    expect(view.result.current.selectedId).toBe("document-1");
    expect(view.result.current.activeContainerId).toBe("root-container");
    expect(view.result.current.selectedDocument?.id).toBe("document-1");
  });
});

test("pending linked document selection keeps the clicked container active", async () => {
  const initialProps: { documents: ReadonlyArray<DocumentSummary> } = {
    documents: [],
  };
  const view = renderHook(
    ({ documents }: { documents: ReadonlyArray<DocumentSummary> }) =>
      useExplorerSelection(nodes, documents),
    { initialProps },
  );

  await waitFor(() => {
    expect(view.result.current.selectedId).toBe("root-container");
  });

  act(() => {
    view.result.current.selectDocument("document-1", "root-container");
  });

  view.rerender({
    documents: [createDocumentSummary({ containerId: "source-container" })],
  });

  await waitFor(() => {
    expect(view.result.current.selectedId).toBe("document-1");
    expect(view.result.current.activeContainerId).toBe("root-container");
    expect(view.result.current.selectedDocument?.containerId).toBe(
      "source-container",
    );
  });
});

test("unknown non-document selection still falls back to the first container", async () => {
  const view = renderHook(() => useExplorerSelection(nodes, []));

  await waitFor(() => {
    expect(view.result.current.selectedId).toBe("root-container");
  });

  act(() => {
    view.result.current.setSelectedId("missing-item");
  });

  await waitFor(() => {
    expect(view.result.current.selectedId).toBe("root-container");
  });
});

test("an orphan selection stays in the recovery collection and follows a later move", async () => {
  const orphanNodes = [
    ...nodes,
    createExplorerOrphanedDocumentsNode("org-1", "Orphaned Documents"),
  ];
  const initialProps: { documents: ReadonlyArray<DocumentSummary> } = {
    documents: [],
  };
  const view = renderHook(
    ({ documents }: { documents: ReadonlyArray<DocumentSummary> }) =>
      useExplorerSelection(orphanNodes, documents),
    { initialProps },
  );

  act(() => {
    view.result.current.selectDocument(
      "document-1",
      EXPLORER_ORPHANED_DOCUMENTS_ID,
    );
  });
  view.rerender({
    documents: [createDocumentSummary({ containerId: null })],
  });

  await waitFor(() => {
    expect(view.result.current.selectedDocument?.containerId).toBeNull();
    expect(view.result.current.activeContainerId).toBe(
      EXPLORER_ORPHANED_DOCUMENTS_ID,
    );
  });

  view.rerender({ documents: [createDocumentSummary()] });
  await waitFor(() => {
    expect(view.result.current.activeContainerId).toBe("root-container");
  });
});

test("a cached orphan does not activate a hidden recovery collection", async () => {
  const orphan = createDocumentSummary({ containerId: null });
  const view = renderHook(() => useExplorerSelection(nodes, [orphan]));

  await waitFor(() => {
    expect(view.result.current.selectedId).toBe("root-container");
  });
  act(() => view.result.current.setSelectedId(orphan.id));

  await waitFor(() => {
    expect(view.result.current.selectedDocument?.id).toBe(orphan.id);
    expect(view.result.current.activeContainerId).toBeNull();
  });
});
