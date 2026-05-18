import { afterEach, expect, test } from "bun:test";
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react";
import {
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useCallback,
  useMemo,
  useState,
} from "react";
import type {
  ExplorerContainerDocumentSidebarRow,
  ExplorerDocumentReadModel,
} from "../../stores/explorer/documentReadModel";
import type { ContainerNode } from "../../stores/explorer/types";
import { buildExplorerTree, useExplorerSidebarPanel } from "./ExplorerTree";

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
  },
];

function createSidebarRows(
  count: number,
): ExplorerContainerDocumentSidebarRow[] {
  return Array.from({ length: count }, (_, index) => {
    const rowNumber = index + 1;
    return {
      containerId: "root-container",
      documentId: `remote-document-${rowNumber}`,
      documentKind: "note",
      localId: `document-${rowNumber}`,
      title: `Document ${rowNumber}`,
      updatedAt: `2026-05-17T00:${String(index).padStart(2, "0")}:00.000Z`,
    };
  });
}

function createDocumentReadModel(
  rows: ReadonlyArray<ExplorerContainerDocumentSidebarRow>,
  calls: Array<{ limit: number; offset: number }>,
): ExplorerDocumentReadModel {
  return {
    applyContainerDocumentTombstones: async () => [],
    listContainerDocumentSidebarWindow: async ({ limit, offset }) => {
      calls.push({ limit, offset });
      return {
        rows: rows.slice(offset, offset + limit),
        totalCount: rows.length,
      };
    },
    listContainerItemWindow: async () => ({ rows: [], totalCount: 0 }),
    loadContainerDocumentWatermark: async () => null,
    loadDocumentSummary: async () => null,
    listLinkedContainerIdsByDocumentIds: async () => new Map(),
    replaceDocumentLinks: async () => undefined,
    replaceDocumentLinksBatch: async () => undefined,
    saveContainerDocumentWatermark: async () => undefined,
    upsertDiscoveredDocuments: async () => [],
  };
}

function ExplorerSidebarHarness(params: {
  documentReadModel: ExplorerDocumentReadModel;
}) {
  const { documentReadModel } = params;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sidebar, setSidebar] = useState<ReactNode>(null);
  const collapsedIds = useMemo(() => new Set<string>(), []);
  const handleSidebarContextMenu = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => event.preventDefault(),
    [],
  );
  const selectDocumentProjection = useCallback(
    (localId: string) => setSelectedId(localId),
    [],
  );
  const toggleCollapsed = useCallback(() => undefined, []);
  const treeEntries = useMemo(() => buildExplorerTree(nodes), []);

  useExplorerSidebarPanel({
    activeContainerId: "root-container",
    collapsedIds,
    documentLinkProjectionVersion: 0,
    documentListRevision: 0,
    documentReadModel,
    handleSidebarContextMenu,
    nodes,
    ready: true,
    selectedId,
    selectDocumentProjection,
    setSelectedId,
    setSidebar,
    toggleCollapsed,
    treeEntries,
  });

  return <div>{sidebar}</div>;
}

test("explorer sidebar requests and renders only a bounded document window", async () => {
  const calls: Array<{ limit: number; offset: number }> = [];
  const documentReadModel = createDocumentReadModel(
    createSidebarRows(55),
    calls,
  );
  const view = render(
    <ExplorerSidebarHarness documentReadModel={documentReadModel} />,
  );

  await waitFor(() => {
    expect(calls).toEqual([{ limit: 50, offset: 0 }]);
  });
  expect(await view.findByRole("button", { name: "Document 1" })).toBeTruthy();
  expect(view.queryByRole("button", { name: "Document 51" })).toBeNull();

  fireEvent.click(view.getByRole("button", { name: "Load 5 more" }));

  await waitFor(() => {
    expect(calls).toEqual([
      { limit: 50, offset: 0 },
      { limit: 50, offset: 50 },
    ]);
  });
  expect(await view.findByRole("button", { name: "Document 51" })).toBeTruthy();
});

test("explorer sidebar shows loading feedback during the first document window request", async () => {
  const calls: Array<{ limit: number; offset: number }> = [];
  const rows = createSidebarRows(1);
  let resolveWindow:
    | ((
        value: Awaited<
          ReturnType<
            ExplorerDocumentReadModel["listContainerDocumentSidebarWindow"]
          >
        >,
      ) => void)
    | undefined;
  const documentReadModel = {
    ...createDocumentReadModel(rows, calls),
    listContainerDocumentSidebarWindow: async ({ limit, offset }) => {
      calls.push({ limit, offset });
      return new Promise((resolve) => {
        resolveWindow = resolve;
      });
    },
  } satisfies ExplorerDocumentReadModel;
  const view = render(
    <ExplorerSidebarHarness documentReadModel={documentReadModel} />,
  );

  const loadingButton = await view.findByRole("button", { name: "Loading..." });
  expect((loadingButton as HTMLButtonElement).disabled).toBe(true);
  expect(calls).toEqual([{ limit: 50, offset: 0 }]);

  await act(async () => {
    resolveWindow?.({
      rows,
      totalCount: rows.length,
    });
  });

  expect(await view.findByRole("button", { name: "Document 1" })).toBeTruthy();
});

test("explorer sidebar can retry a failed initial document window", async () => {
  const calls: Array<{ limit: number; offset: number }> = [];
  const rows = createSidebarRows(1);
  const documentReadModel = {
    ...createDocumentReadModel(rows, calls),
    listContainerDocumentSidebarWindow: async ({ limit, offset }) => {
      calls.push({ limit, offset });
      if (calls.length === 1) {
        throw new Error("window failed");
      }

      return {
        rows: rows.slice(offset, offset + limit),
        totalCount: rows.length,
      };
    },
  } satisfies ExplorerDocumentReadModel;
  const view = render(
    <ExplorerSidebarHarness documentReadModel={documentReadModel} />,
  );

  fireEvent.click(await view.findByRole("button", { name: "Retry" }));

  await waitFor(() => {
    expect(calls).toEqual([
      { limit: 50, offset: 0 },
      { limit: 50, offset: 0 },
    ]);
  });
  expect(await view.findByRole("button", { name: "Document 1" })).toBeTruthy();
});
