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

// A link refresh must never blank a populated container: the stale rows stay
// rendered while the replacement window loads and swap in place when it lands.
// A burst of membership bumps (bulk import) coalesces into one reload pass.
test("sidebar link refresh keeps stale rows visible until the reload lands", async () => {
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
      documentListRevision,
      documentLinkProjectionVersionByContainerId,
      ready,
    }: {
      documentListRevision: number;
      documentLinkProjectionVersionByContainerId: ReadonlyMap<string, number>;
      ready: boolean;
    }) =>
      useExplorerSidebarDocumentWindows({
        collapsedIds: new Set(),
        documentLinkProjectionVersionByContainerId,
        documentListRevision,
        documentQueries: queries,
        nodes,
        ready,
        treeEntries,
      }),
    {
      initialProps: {
        documentListRevision: 0,
        documentLinkProjectionVersionByContainerId: new Map<string, number>(),
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

  // Two rapid membership bumps: the trailing throttle coalesces them into one
  // reload pass, so exactly one further query fires.
  view.rerender({
    documentListRevision: 0,
    documentLinkProjectionVersionByContainerId: new Map([
      [CONTACTS_CONTAINER_ID, 1],
    ]),
    ready: true,
  });
  view.rerender({
    documentListRevision: 0,
    documentLinkProjectionVersionByContainerId: new Map([
      [CONTACTS_CONTAINER_ID, 2],
    ]),
    ready: true,
  });

  await waitFor(() => {
    expect(calls.length).toBe(2);
  });
  expect(calls[1]).toEqual({
    containerId: CONTACTS_CONTAINER_ID,
    limit: 1,
    offset: 0,
  });

  // While the reload is in flight the stale row stays rendered — no blank, no
  // placeholder flash.
  const inFlightWindow = view.result.current.documentWindowsByContainerId.get(
    CONTACTS_CONTAINER_ID,
  );
  expect(inFlightWindow?.isLoading).toBe(true);
  expect(inFlightWindow?.rows.map((row) => row.localId)).toEqual(["contact-1"]);
  expect(inFlightWindow?.totalCount).toBe(1);
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
  expect(sidebarRows.map((row) => row.kind)).toEqual(["container", "document"]);

  // The swap lands in place: the fresh (now empty) membership replaces the
  // stale rows only when the reload resolves.
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

// The cross-org flicker, upgraded: reload passes are non-destructive for EVERY
// container, so a membership change in one org's container leaves both that
// container's and the other org's rows on screen throughout the refresh.
test("a version bump never blanks any expanded container's rows", async () => {
  const queries = {
    listContainerDocumentSidebarWindow: async (input: {
      containerId: string;
      limit: number;
      offset: number;
    }) => ({
      rows:
        input.limit > 0
          ? [
              documentRow({
                containerId: input.containerId,
                localId: `${input.containerId}-doc`,
              }),
            ]
          : [],
      totalCount: 1,
    }),
  } as unknown as ContainerDocumentQueries;

  const nodes = [
    containerNode({ id: "personal", name: "Personal" }),
    containerNode({ id: "custom", name: "Custom" }),
  ];
  const treeEntries = buildExplorerTree(nodes);

  const view = renderHook(
    ({ versions }: { versions: ReadonlyMap<string, number> }) =>
      useExplorerSidebarDocumentWindows({
        collapsedIds: new Set(),
        documentLinkProjectionVersionByContainerId: versions,
        documentListRevision: 0,
        documentQueries: queries,
        nodes,
        ready: true,
        treeEntries,
      }),
    { initialProps: { versions: new Map<string, number>() } },
  );

  act(() => {
    view.result.current.requestDocumentWindow("personal", 0, 1);
    view.result.current.requestDocumentWindow("custom", 0, 1);
  });
  await waitFor(() => {
    expect(
      view.result.current.documentWindowsByContainerId.get("personal")?.rows,
    ).toHaveLength(1);
    expect(
      view.result.current.documentWindowsByContainerId.get("custom")?.rows,
    ).toHaveLength(1);
  });

  // A membership change in the custom org bumps ONLY its container's version.
  act(() => {
    view.rerender({ versions: new Map([["custom", 1]]) });
  });

  // Synchronously after the bump: nothing blanked — both containers keep their
  // rows while the coalesced reload pass is pending.
  expect(
    view.result.current.documentWindowsByContainerId.get("custom")?.rows,
  ).toHaveLength(1);
  expect(
    view.result.current.documentWindowsByContainerId.get("personal")?.rows,
  ).toHaveLength(1);

  // After the throttled pass fires and settles, the rows are still present:
  // the refresh swapped in place rather than blanking and refilling.
  await waitFor(() => {
    const custom =
      view.result.current.documentWindowsByContainerId.get("custom");
    expect(custom?.isLoading).toBe(false);
    expect(custom?.rows).toHaveLength(1);
  });
  expect(
    view.result.current.documentWindowsByContainerId.get("personal")?.rows,
  ).toHaveLength(1);
});
