import { afterEach, expect, test } from "bun:test";
import type {
  ContainerDocumentQueries,
  ContainerNode,
} from "@tearleads/client-sdk";
import { syncedContainerDocumentObjectSyncState as syncedState } from "@tearleads/client-sdk";
import { act, cleanup, fireEvent, waitFor } from "@testing-library/react";
import {
  createExplorerDocumentQueries as createDocumentQueries,
  createExplorerRowsByContainerId as createRowsByContainerId,
  createExplorerSidebarRows as createSidebarRows,
  defaultNodes,
  type ExplorerSidebarWindowCall,
  getSidebarViewport,
  renderExplorerSidebar,
} from "./ExplorerTree.testFixtures";

afterEach(() => {
  cleanup();
});

test("explorer sidebar requests new document windows as the sidebar scrolls", async () => {
  const calls: ExplorerSidebarWindowCall[] = [];
  const documentQueries = createDocumentQueries(
    createRowsByContainerId(createSidebarRows(80)),
    calls,
  );
  const view = renderExplorerSidebar({ documentQueries });

  await waitFor(() => {
    expect(calls).toContainEqual({
      containerId: "root-container",
      limit: 24,
      offset: 0,
    });
  });
  expect(await view.findByRole("button", { name: "Document 1" })).toBeTruthy();
  expect(view.queryByRole("button", { name: "Document 25" })).toBeNull();

  const sidebarViewport = getSidebarViewport(view);

  sidebarViewport.scrollTop = 840;
  fireEvent.scroll(sidebarViewport);

  await waitFor(() => {
    expect(calls).toContainEqual({
      containerId: "root-container",
      limit: 24,
      offset: 21,
    });
  });
  expect(await view.findByRole("button", { name: "Document 22" })).toBeTruthy();
});

test("explorer sidebar scroll requests windows for each folder independently", async () => {
  const childNodes: ContainerNode[] = [
    ...defaultNodes,
    {
      id: "child-container",
      kind: "container",
      name: "Child",
      organizationId: "org-1",
      parentId: "root-container",
      syncState: syncedState,
    },
  ];
  const calls: ExplorerSidebarWindowCall[] = [];
  const documentQueries = createDocumentQueries(
    new Map([
      ["child-container", createSidebarRows(80, "child-container")],
      ["root-container", createSidebarRows(5)],
    ]),
    calls,
  );
  const view = renderExplorerSidebar({ documentQueries, nodes: childNodes });

  await waitFor(() => {
    expect(calls).toContainEqual({
      containerId: "child-container",
      limit: 24,
      offset: 0,
    });
  });

  const sidebarViewport = getSidebarViewport(view);

  sidebarViewport.scrollTop = 840;
  fireEvent.scroll(sidebarViewport);

  await waitFor(() => {
    expect(calls).toContainEqual({
      containerId: "child-container",
      limit: 24,
      offset: 20,
    });
  });
  expect(
    calls.some(
      (call) => call.containerId === "root-container" && call.offset === 20,
    ),
  ).toBe(false);
});

test("explorer sidebar renders configured Phosphor icons for containers", async () => {
  const childNodes: ContainerNode[] = [
    ...defaultNodes,
    {
      id: "child-container",
      icon: "folder",
      kind: "container",
      name: "Child",
      organizationId: "org-1",
      parentId: "root-container",
      syncState: syncedState,
    },
    {
      id: "trash-container",
      icon: "trash",
      kind: "container",
      name: "Trash",
      organizationId: "org-1",
      parentId: "root-container",
      syncState: syncedState,
    },
  ];
  const documentQueries = createDocumentQueries(
    new Map([
      ["child-container", []],
      ["root-container", []],
      ["trash-container", []],
    ]),
    [],
  );
  const view = renderExplorerSidebar({ documentQueries, nodes: childNodes });

  const rootButton = await view.findByRole("button", { name: "Root" });
  const rootIcon = rootButton.querySelector(".explorer-folder-icon");
  expect(rootIcon?.getAttribute("data-icon")).toBe("folder-open");

  const childButton = await view.findByRole("button", { name: "Child" });
  const childIcon = childButton.querySelector(".explorer-folder-icon");
  expect(childIcon?.getAttribute("data-container-icon")).toBe("folder");
  expect(childIcon?.getAttribute("data-icon")).toBe("folder");

  const trashButton = await view.findByRole("button", { name: "Trash" });
  const trashIcon = trashButton.querySelector(".explorer-folder-icon");
  expect(trashIcon?.getAttribute("data-container-icon")).toBe("trash");
  expect(trashIcon?.getAttribute("data-icon")).toBe("trash");

  view.unmount();

  const collapsedView = renderExplorerSidebar({
    collapsedIds: new Set(["root-container"]),
    documentQueries,
    nodes: childNodes,
  });
  const collapsedRootButton = await collapsedView.findByRole("button", {
    name: "Root",
  });
  const collapsedRootIcon = collapsedRootButton.querySelector(
    ".explorer-folder-icon",
  );
  expect(collapsedRootIcon?.getAttribute("data-icon")).toBe("folder");
});

test("explorer sidebar renders document type icons for documents", async () => {
  const documentQueries = createDocumentQueries(
    createRowsByContainerId(createSidebarRows(1)),
    [],
  );
  const view = renderExplorerSidebar({ documentQueries });

  const documentButton = await view.findByRole("button", {
    name: "Document 1",
  });
  const documentIcon = documentButton.querySelector(".explorer-document-icon");
  expect(documentIcon?.getAttribute("data-icon")).toBe("note");
});

test("explorer sidebar ignores stale document windows during fast scrolling", async () => {
  const rows = createSidebarRows(90);
  const calls: ExplorerSidebarWindowCall[] = [];
  let resolveFirstScroll:
    | ((
        value: Awaited<
          ReturnType<
            ContainerDocumentQueries["listContainerDocumentSidebarWindow"]
          >
        >,
      ) => void)
    | undefined;
  let resolveSecondScroll:
    | ((
        value: Awaited<
          ReturnType<
            ContainerDocumentQueries["listContainerDocumentSidebarWindow"]
          >
        >,
      ) => void)
    | undefined;
  const documentQueries = {
    ...createDocumentQueries(createRowsByContainerId(rows), calls),
    listContainerDocumentSidebarWindow: async ({
      containerId,
      limit,
      offset,
    }) => {
      calls.push({ containerId, limit, offset });
      if (offset === 21) {
        return new Promise((resolve) => {
          resolveFirstScroll = resolve;
        });
      }
      if (offset === 41) {
        return new Promise((resolve) => {
          resolveSecondScroll = resolve;
        });
      }

      return {
        rows: rows.slice(offset, offset + limit),
        totalCount: rows.length,
      };
    },
  } satisfies ContainerDocumentQueries;
  const view = renderExplorerSidebar({ documentQueries });

  expect(await view.findByRole("button", { name: "Document 1" })).toBeTruthy();
  const sidebarViewport = getSidebarViewport(view);

  sidebarViewport.scrollTop = 840;
  fireEvent.scroll(sidebarViewport);
  await waitFor(() => {
    expect(calls).toContainEqual({
      containerId: "root-container",
      limit: 24,
      offset: 21,
    });
  });

  sidebarViewport.scrollTop = 1400;
  fireEvent.scroll(sidebarViewport);
  await waitFor(() => {
    expect(calls).toContainEqual({
      containerId: "root-container",
      limit: 24,
      offset: 41,
    });
  });

  await act(async () => {
    resolveSecondScroll?.({
      rows: rows.slice(41, 65),
      totalCount: rows.length,
    });
  });
  expect(await view.findByRole("button", { name: "Document 60" })).toBeTruthy();

  await act(async () => {
    resolveFirstScroll?.({
      rows: rows.slice(21, 45),
      totalCount: rows.length,
    });
  });
  expect(view.getByRole("button", { name: "Document 60" })).toBeTruthy();
});

test("explorer sidebar forwards document context-menu events with document and container ids", async () => {
  const calls: Array<{ containerId: string; localId: string }> = [];
  const documentQueries = createDocumentQueries(
    createRowsByContainerId(createSidebarRows(1)),
    [],
  );
  const view = renderExplorerSidebar({
    documentQueries,
    onDocumentContextMenu: (localId, containerId) => {
      calls.push({ containerId, localId });
    },
  });

  fireEvent.contextMenu(
    await view.findByRole("button", { name: "Document 1" }),
  );

  expect(calls).toEqual([
    { containerId: "root-container", localId: "root-container-document-1" },
  ]);
});
