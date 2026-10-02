import { afterEach, expect, test } from "bun:test";
import type { ContainerNode, DocumentSummary } from "@tearleads/client-sdk";
import { syncedContainerDocumentObjectSyncState } from "@tearleads/client-sdk";
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

function containerNode(
  id: string,
  overrides: Partial<ContainerNode> = {},
): ContainerNode {
  return {
    id,
    kind: "container",
    name: id,
    organizationId: "org-1",
    parentId: "root-container",
    syncState: syncedContainerDocumentObjectSyncState,
    ...overrides,
  };
}

function renderSelection(initialNodes: ReadonlyArray<ContainerNode>) {
  return renderHook(
    ({ current }: { current: ReadonlyArray<ContainerNode> }) =>
      useExplorerSelection(current, []),
    { initialProps: { current: initialNodes } },
  );
}

const replacedRoot = containerNode("replaced-root", {
  organizationId: "org-2",
  parentId: null,
});

// #2393: a recovered device replaces its locally created Contacts with the
// identity's existing one under a new id; the selection follows it.
test("a replaced system container keeps its selection", async () => {
  const localContacts = containerNode("local-contacts", { systemSlot: "slot" });
  const view = renderSelection([nodes[0] as ContainerNode, localContacts]);
  act(() => view.result.current.setSelectedId("local-contacts"));

  view.rerender({
    current: [
      replacedRoot,
      containerNode("trash", { systemSlot: "trash-slot" }),
      containerNode("contacts", { systemSlot: "slot" }),
    ],
  });

  await waitFor(() => {
    expect(view.result.current.selectedId).toBe("contacts");
  });
});

test("a vanished ordinary container or ambiguous slot falls back to the root", async () => {
  const folder = containerNode("folder");
  const contacts = containerNode("contacts", { systemSlot: "slot" });
  const view = renderSelection([nodes[0] as ContainerNode, folder, contacts]);
  act(() => view.result.current.setSelectedId("folder"));

  view.rerender({ current: [replacedRoot, contacts] });
  await waitFor(() => {
    expect(view.result.current.selectedId).toBe("replaced-root");
  });

  act(() => view.result.current.setSelectedId("contacts"));
  view.rerender({
    current: [
      replacedRoot,
      containerNode("contacts-a", { systemSlot: "slot" }),
      containerNode("contacts-b", { systemSlot: "slot" }),
    ],
  });
  await waitFor(() => {
    expect(view.result.current.selectedId).toBe("replaced-root");
  });
});
