import { afterEach, expect, test } from "bun:test";
import type { ContainerNode } from "@tearleads/client-sdk";
import type { DocumentSummary } from "@tearleads/client-sdk/documents";
import { syncedContainerDocumentObjectSyncState } from "@tearleads/client-sdk/workflows/container-contents";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
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
