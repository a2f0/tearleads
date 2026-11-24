import { afterEach, expect, test } from "bun:test";
import type {
  ContainerDocumentQueries,
  ContainerItemRow,
} from "@tearleads/client-sdk";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import {
  alphaNoteRow,
  containerA,
  containerB,
  containerDetailElement,
  renderContainerDetail,
} from "../../../../../test/helpers/explorer/containerDetailFixtures";
import {
  archiveRow,
  noteRow,
  renderContainerItemTable,
} from "../../../../../test/helpers/explorer/containerItemTableFixtures";
import type { MiniAppItemView } from "../../../../components/mini-app/item-view/miniAppItemView";
import { EXPLORER_LABELS, getExplorerItemTableLabel } from "../../labels";
import { ExplorerContainerItemGrid } from "./ExplorerContainerItemGrid";
import { ExplorerItemViewProvider } from "./explorerItemViewContext";

const originalClientWidthDescriptor = Object.getOwnPropertyDescriptor(
  globalThis.HTMLElement?.prototype ?? {},
  "clientWidth",
);

afterEach(() => {
  cleanup();
  if (originalClientWidthDescriptor) {
    Object.defineProperty(
      HTMLElement.prototype,
      "clientWidth",
      originalClientWidthDescriptor,
    );
  }
});

// happy-dom has no layout, so stand in for the frame width a browser measures.
function mockFrameWidth(width: number) {
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get: () => width,
  });
}

function recordingDocumentQueries(rows: ReadonlyArray<ContainerItemRow>) {
  const requests: Array<{ limit: number; offset: number }> = [];
  const documentQueries = {
    listContainerItemWindow: async (input: {
      limit: number;
      offset: number;
    }) => {
      requests.push({ limit: input.limit, offset: input.offset });
      return { rows, totalCount: rows.length };
    },
  } as unknown as ContainerDocumentQueries;
  return { documentQueries, requests };
}

async function renderDetailInView(
  view: MiniAppItemView,
  rows: ReadonlyArray<ContainerItemRow>,
) {
  const { documentQueries, requests } = recordingDocumentQueries(rows);
  const result = render(
    <ExplorerItemViewProvider value={view}>
      {containerDetailElement(renderContainerDetail({ documentQueries }))}
    </ExplorerItemViewProvider>,
  );
  await act(async () => undefined);
  return { requests, result };
}

test("the grid fetches whole lines of the tiles its measured frame fits", async () => {
  // A 390px frame fits three tiles across.
  mockFrameWidth(390);
  const { requests, result } = await renderDetailInView("grid", [
    archiveRow,
    alphaNoteRow,
  ]);

  const lastRequest = requests.at(-1);
  expect(lastRequest?.offset).toBe(0);
  expect((lastRequest?.limit ?? 0) % 3).toBe(0);
  // The window's minimum of 24 lines, three items each.
  expect(lastRequest?.limit).toBe(72);

  const grid = result.getByRole("list", {
    name: getExplorerItemTableLabel(containerA.name),
  });
  expect(grid.children).toHaveLength(2);
  expect(result.getByRole("button", { name: archiveRow.name })).toBeTruthy();
  expect(result.getByRole("button", { name: alphaNoteRow.name })).toBeTruthy();
  // The grid keeps sorting in its pinned header.
  expect(
    result.getByRole("combobox", {
      name: new RegExp(`^${EXPLORER_LABELS.itemSortMenuLabel}: `),
    }),
  ).toBeTruthy();
  expect(result.queryByRole("table")).toBeNull();
});

test("large rows publish the shared large-row pitch on the item table frame", async () => {
  const { result } = await renderDetailInView("large-rows", [alphaNoteRow]);

  const table = result.getByRole("table", {
    name: getExplorerItemTableLabel(containerA.name),
  });
  const frame = table.closest(".explorer-item-table-wrap");
  if (!(frame instanceof HTMLElement)) {
    throw new Error("Expected the item table frame.");
  }

  expect(frame.getAttribute("data-item-view")).toBe("large-rows");
  expect(frame.style.getPropertyValue("--mini-app-virtual-row-height")).toBe(
    "96px",
  );
  const nameButton = result.getByRole("button", { name: alphaNoteRow.name });
  expect(nameButton.querySelector(".mini-app-item-thumb")).toBeTruthy();
});

test("the dense rows keep their small inline visual", () => {
  const view = renderContainerItemTable({ rows: [noteRow], totalCount: 1 });

  const frame = view.container.querySelector(".explorer-item-table-wrap");
  expect(frame?.getAttribute("data-item-view")).toBe("rows");
  const nameButton = view.getByRole("button", { name: noteRow.name });
  expect(nameButton.querySelector(".mini-app-item-thumb")).toBeNull();
  expect(nameButton.querySelector(".explorer-item-icon")).toBeTruthy();
});

test("a grid tile opens, right-clicks, and highlights like a row", () => {
  const opened: string[] = [];
  const menus: string[] = [];
  const blankMenus: string[] = [];
  const view = render(
    <ExplorerContainerItemGrid
      columns={3}
      avatarUrlByLocalId={{}}
      contextTarget={{
        containerId: "root-container",
        kind: "document",
        localId: noteRow.localId,
      }}
      currentSigningFingerprint={null}
      currentSelfContactLocalId={null}
      currentUserId={null}
      dragActive={false}
      dragDisabled={false}
      emptyLabel={EXPLORER_LABELS.itemTableEmpty}
      error={null}
      frameRef={() => undefined}
      handleDragEnter={() => undefined}
      handleDragLeave={() => undefined}
      handleDragOver={() => undefined}
      handleDrop={() => undefined}
      isImporting={false}
      isLoading={false}
      online
      onBlankContextMenu={(_event, containerId) => blankMenus.push(containerId)}
      onItemContextMenu={(_event, row) => menus.push(row.name)}
      onSort={() => undefined}
      rowHeight={136}
      rowOffset={0}
      rows={[archiveRow, noteRow]}
      selectedNode={containerB}
      selectDocumentProjection={(documentId) => opened.push(documentId)}
      setSelectedId={(id) => opened.push(id ?? "")}
      sort={{ direction: "asc", key: "name" }}
      totalCount={2}
    />,
  );

  const folderTile = view.getByRole("button", { name: archiveRow.name });
  const noteTile = view.getByRole("button", { name: noteRow.name });
  fireEvent.click(folderTile);
  fireEvent.click(noteTile);
  expect(opened).toEqual(["archive-container", noteRow.localId]);

  fireEvent.contextMenu(noteTile);
  expect(menus).toEqual([noteRow.name]);
  expect(blankMenus).toEqual([]);
  expect(noteTile.classList.contains("mini-app-item-tile--selected")).toBe(
    true,
  );
  expect(folderTile.classList.contains("mini-app-item-tile--selected")).toBe(
    false,
  );

  // Empty space in the frame opens the container's own menu.
  const frame = view.container.querySelector(".explorer-item-grid-frame");
  if (!(frame instanceof HTMLElement)) {
    throw new Error("Expected the grid frame.");
  }
  fireEvent.contextMenu(frame);
  expect(blankMenus).toEqual([containerB.id]);
});
