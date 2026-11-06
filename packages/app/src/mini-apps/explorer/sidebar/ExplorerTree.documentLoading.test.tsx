import { afterEach, expect, test } from "bun:test";
import type { ContainerDocumentQueries } from "@tearleads/client-sdk";
import { act, cleanup, fireEvent, waitFor } from "@testing-library/react";
import {
  createExplorerDocumentQueries as createDocumentQueries,
  createExplorerRowsByContainerId as createRowsByContainerId,
  createExplorerSidebarRows as createSidebarRows,
  type ExplorerSidebarWindowCall,
  explorerSidebarElement,
  renderExplorerSidebar,
} from "./ExplorerTree.testFixtures";

afterEach(() => {
  cleanup();
});

test("explorer sidebar shows loading feedback during the first document window request", async () => {
  const calls: ExplorerSidebarWindowCall[] = [];
  const rows = createSidebarRows(1);
  let resolveWindow:
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
      return new Promise((resolve) => {
        resolveWindow = resolve;
      });
    },
  } satisfies ContainerDocumentQueries;
  const view = renderExplorerSidebar({ documentQueries });

  const loadingButton = await view.findByRole("button", { name: "Loading..." });
  expect((loadingButton as HTMLButtonElement).disabled).toBe(true);
  expect(calls).toContainEqual({
    containerId: "root-container",
    limit: 24,
    offset: 0,
  });

  await act(async () => {
    resolveWindow?.({
      rows,
      totalCount: rows.length,
    });
  });

  expect(await view.findByRole("button", { name: "Document 1" })).toBeTruthy();
});

test("explorer sidebar can retry a failed initial document window", async () => {
  const calls: ExplorerSidebarWindowCall[] = [];
  const rows = createSidebarRows(1);
  const documentQueries = {
    ...createDocumentQueries(createRowsByContainerId(rows), calls),
    listContainerDocumentSidebarWindow: async ({
      containerId,
      limit,
      offset,
    }) => {
      calls.push({ containerId, limit, offset });
      if (calls.length <= 2) {
        throw new Error("window failed");
      }

      return {
        rows: rows.slice(offset, offset + limit),
        totalCount: rows.length,
      };
    },
  } satisfies ContainerDocumentQueries;
  const view = renderExplorerSidebar({ documentQueries });

  fireEvent.click(await view.findByRole("button", { name: "Retry" }));

  await waitFor(() => {
    expect(calls).toContainEqual({
      containerId: "root-container",
      limit: 24,
      offset: 0,
    });
  });
  expect(await view.findByRole("button", { name: "Document 1" })).toBeTruthy();
});

test("explorer sidebar keeps existing documents visible during document list refreshes", async () => {
  const rows = createSidebarRows(1);
  const refreshedRows = rows.map((row) => ({
    ...row,
    title: "Renamed Document",
  }));
  const calls: ExplorerSidebarWindowCall[] = [];
  let resolveRefresh:
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
      if (calls.length <= 2) {
        return {
          rows: rows.slice(offset, offset + limit),
          totalCount: rows.length,
        };
      }

      return new Promise((resolve) => {
        resolveRefresh = resolve;
      });
    },
  } satisfies ContainerDocumentQueries;
  const view = renderExplorerSidebar({
    documentListRevision: 0,
    documentQueries,
  });

  expect(await view.findByRole("button", { name: "Document 1" })).toBeTruthy();

  view.rerender(
    explorerSidebarElement({
      documentListRevision: 1,
      documentQueries,
    }),
  );

  await waitFor(() => {
    expect(calls.length).toBeGreaterThanOrEqual(3);
  });
  expect(view.getByRole("button", { name: "Document 1" })).toBeTruthy();

  await act(async () => {
    resolveRefresh?.({
      rows: refreshedRows,
      totalCount: rows.length,
    });
  });
  expect(
    await view.findByRole("button", { name: "Renamed Document" }),
  ).toBeTruthy();
});

test("explorer sidebar does not refresh loaded documents on collapsed state changes", async () => {
  const calls: ExplorerSidebarWindowCall[] = [];
  const documentQueries = createDocumentQueries(
    createRowsByContainerId(createSidebarRows(1)),
    calls,
  );
  const view = renderExplorerSidebar({ documentQueries });

  expect(await view.findByRole("button", { name: "Document 1" })).toBeTruthy();
  expect(calls).toEqual([
    { containerId: "root-container", limit: 0, offset: 0 },
    { containerId: "root-container", limit: 24, offset: 0 },
  ]);

  view.rerender(
    explorerSidebarElement({
      collapsedIds: new Set(["root-container"]),
      documentQueries,
    }),
  );
  expect(view.queryByRole("button", { name: "Document 1" })).toBeNull();

  view.rerender(
    explorerSidebarElement({
      collapsedIds: new Set(),
      documentQueries,
    }),
  );

  expect(await view.findByRole("button", { name: "Document 1" })).toBeTruthy();
  expect(calls).toEqual([
    { containerId: "root-container", limit: 0, offset: 0 },
    { containerId: "root-container", limit: 24, offset: 0 },
  ]);
});
