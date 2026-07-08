import { afterEach, expect, test } from "bun:test";
import type {
  ContainerDocumentQueries,
  ContainerDocumentSidebarRow,
  ContainerNode,
} from "@tearleads/client-sdk";
import { syncedContainerDocumentObjectSyncState } from "@tearleads/client-sdk";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import {
  buildExplorerSidebarSections,
  getExplorerSidebarRowsInRange,
} from "./ExplorerSidebarRows";
import { buildExplorerTree } from "./explorerTreeModel";
import { useExplorerSidebarDocumentWindows } from "./useExplorerSidebarWindows";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve: ((value: T) => void) | undefined;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  if (!resolve) {
    throw new Error("Failed to create deferred.");
  }

  return { promise, resolve };
}

const CONTACTS_CONTAINER_ID = "contacts-container";

function containerNode(overrides: Pick<ContainerNode, "id" | "name">) {
  return {
    kind: "container",
    organizationId: "org-1",
    parentId: null,
    syncState: syncedContainerDocumentObjectSyncState,
    ...overrides,
  } satisfies ContainerNode;
}

function documentRow(
  overrides: Partial<ContainerDocumentSidebarRow> = {},
): ContainerDocumentSidebarRow {
  return {
    containerId: CONTACTS_CONTAINER_ID,
    documentId: "document-1",
    documentKind: "contact",
    localId: "contact-1",
    syncState: syncedContainerDocumentObjectSyncState,
    title: "Contact 1",
    updatedAt: "2026-07-08T00:00:00.000Z",
    ...overrides,
  };
}

afterEach(() => cleanup());

test("sidebar document link refresh hides stale rows without loading status", async () => {
  const reload = createDeferred<{
    rows: ReadonlyArray<ContainerDocumentSidebarRow>;
    totalCount: number;
  }>();
  const calls: Array<{ containerId: string; limit: number; offset: number }> =
    [];
  const queries = {
    listContainerDocumentSidebarWindow: async (input) => {
      calls.push(input);
      if (calls.length === 1) {
        return { rows: [documentRow()], totalCount: 1 };
      }

      return reload.promise;
    },
  } satisfies Partial<ContainerDocumentQueries> as ContainerDocumentQueries;
  const nodes = [
    containerNode({ id: CONTACTS_CONTAINER_ID, name: "Contacts" }),
  ];
  const treeEntries = buildExplorerTree(nodes);
  const view = renderHook(
    ({
      documentLinkProjectionVersion,
      ready,
    }: {
      documentLinkProjectionVersion: number;
      ready: boolean;
    }) =>
      useExplorerSidebarDocumentWindows({
        collapsedIds: new Set(),
        documentLinkProjectionVersion,
        documentListRevision: 0,
        documentQueries: queries,
        nodes,
        ready,
        treeEntries,
      }),
    {
      initialProps: {
        documentLinkProjectionVersion: 0,
        ready: false,
      },
    },
  );

  act(() => {
    view.result.current.requestDocumentWindow(CONTACTS_CONTAINER_ID, 0, 1);
  });

  await waitFor(() => {
    expect(
      view.result.current.documentWindowsByContainerId
        .get(CONTACTS_CONTAINER_ID)
        ?.rows.map((row) => row.localId),
    ).toEqual(["contact-1"]);
  });

  view.rerender({
    documentLinkProjectionVersion: 1,
    ready: true,
  });

  await waitFor(() => {
    const window = view.result.current.documentWindowsByContainerId.get(
      CONTACTS_CONTAINER_ID,
    );
    expect(window?.isLoading).toBe(true);
    expect(window?.rows).toEqual([]);
    expect(window?.showLoadingStatus).toBe(false);
    expect(window?.totalCount).toBeNull();
  });
  const sections = buildExplorerSidebarSections({
    collapsedIds: new Set(),
    documentWindowsByContainerId:
      view.result.current.documentWindowsByContainerId,
    entries: treeEntries,
    organizationNamesById: new Map(),
    primaryOrganizationId: null,
  });
  const sidebarRows = getExplorerSidebarRowsInRange({
    collapsedIds: new Set(),
    limit: 10,
    offset: 0,
    sections,
  });
  expect(sidebarRows.map((row) => row.kind)).toEqual(["container"]);
  expect(calls).toEqual([
    { containerId: CONTACTS_CONTAINER_ID, limit: 1, offset: 0 },
    { containerId: CONTACTS_CONTAINER_ID, limit: 1, offset: 0 },
  ]);

  act(() => {
    reload.resolve({ rows: [], totalCount: 0 });
  });

  await waitFor(() => {
    const window = view.result.current.documentWindowsByContainerId.get(
      CONTACTS_CONTAINER_ID,
    );
    expect(window?.isLoading).toBe(false);
    expect(window?.rows).toEqual([]);
    expect(window?.totalCount).toBe(0);
  });
});
