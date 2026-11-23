import { afterEach, expect, test } from "bun:test";
import type { ContainerNode } from "@tearleads/client-sdk";
import {
  act,
  cleanup,
  fireEvent,
  type RenderResult,
  render,
} from "@testing-library/react";
import {
  alphaNoteRow,
  containerA,
  containerB,
  containerDetailElement,
  createDeferredDocumentQueries,
  idleUploadManager,
  renderContainerDetail,
  settlePendingItemWindow,
} from "../../../../../test/helpers/explorer/containerDetailFixtures";
import type { ExplorerUploadManager } from "../../hooks/useExplorerUploadManager";
import { EXPLORER_LABELS } from "../../labels";
import { renderExplorerItemCell } from "./explorerItemTableColumns";

const originalClientWidthDescriptor = Object.getOwnPropertyDescriptor(
  globalThis.HTMLElement?.prototype ?? {},
  "clientWidth",
);

// happy-dom has no layout engine, so every clientWidth is 0 — which the fold
// predicate reads as "not measured" and ignores. Stand in for the layout a
// browser would do. The initial measurement is a direct clientWidth read, so
// this works even though the preload's ResizeObserver stub never fires.
function mockFrameWidth(width: number) {
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get: () => width,
  });
}

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

function headerActionsLabel(node: ContainerNode): string {
  return `${EXPLORER_LABELS.containerHeaderActionsLabel}: ${node.name}`;
}

test("an empty container keeps No items. on refetches instead of flashing the loading row", async () => {
  const { documentQueries, pending } = createDeferredDocumentQueries();
  const props = renderContainerDetail({ documentQueries });
  const view = render(containerDetailElement(props));

  // The first load has nothing settled to show, so the loading row is right.
  expect(view.getByText("Loading...")).toBeTruthy();
  expect(view.queryByText(EXPLORER_LABELS.itemTableEmpty)).toBeNull();

  await settlePendingItemWindow(pending, { rows: [], totalCount: 0 });
  expect(view.getByText(EXPLORER_LABELS.itemTableEmpty)).toBeTruthy();

  // A convergence-driven refetch (list revision bump) starts a new fetch; the
  // settled empty state must hold on screen while it is in flight.
  view.rerender(containerDetailElement({ ...props, documentListRevision: 1 }));
  expect(pending.length).toBe(1);
  expect(view.queryByText("Loading...")).toBeNull();
  expect(view.getByText(EXPLORER_LABELS.itemTableEmpty)).toBeTruthy();

  await settlePendingItemWindow(pending, { rows: [], totalCount: 0 });
  expect(view.queryByText("Loading...")).toBeNull();
  expect(view.getByText(EXPLORER_LABELS.itemTableEmpty)).toBeTruthy();
});

test("a refetch that discovers items replaces the empty state with rows", async () => {
  const { documentQueries, pending } = createDeferredDocumentQueries();
  const props = renderContainerDetail({ documentQueries });
  const view = render(containerDetailElement(props));

  await settlePendingItemWindow(pending, { rows: [], totalCount: 0 });
  expect(view.getByText(EXPLORER_LABELS.itemTableEmpty)).toBeTruthy();

  view.rerender(containerDetailElement({ ...props, documentListRevision: 1 }));
  await settlePendingItemWindow(pending, {
    rows: [alphaNoteRow],
    totalCount: 1,
  });

  expect(view.getByRole("button", { name: alphaNoteRow.name })).toBeTruthy();
  expect(view.queryByText(EXPLORER_LABELS.itemTableEmpty)).toBeNull();
});

test("switching containers shows the loading row, not the previous container's state", async () => {
  const { documentQueries, pending } = createDeferredDocumentQueries();
  const props = renderContainerDetail({ documentQueries });
  const view = render(containerDetailElement(props));

  await settlePendingItemWindow(pending, {
    rows: [alphaNoteRow],
    totalCount: 1,
  });
  expect(view.getByRole("button", { name: alphaNoteRow.name })).toBeTruthy();

  view.rerender(containerDetailElement({ ...props, selectedNode: containerB }));
  expect(view.getByText("Loading...")).toBeTruthy();
  expect(view.queryByRole("button", { name: alphaNoteRow.name })).toBeNull();
  expect(view.queryByText(EXPLORER_LABELS.itemTableEmpty)).toBeNull();

  await settlePendingItemWindow(pending, { rows: [], totalCount: 0 });
  expect(view.getByText(EXPLORER_LABELS.itemTableEmpty)).toBeTruthy();
});

test("a failed initial load shows the error instead of a stuck loading row", async () => {
  const { documentQueries, pending } = createDeferredDocumentQueries();
  const props = renderContainerDetail({ documentQueries });
  const view = render(containerDetailElement(props));

  const deferred = pending.shift();
  if (!deferred) {
    throw new Error("Expected a pending listContainerItemWindow call.");
  }

  await act(async () => {
    deferred.reject(new Error("query exploded"));
  });

  expect(view.queryByText("Loading...")).toBeNull();
  expect(view.getByText("query exploded")).toBeTruthy();
});

const pagedNoteRows = Array.from({ length: 80 }, (_, index) => ({
  ...alphaNoteRow,
  documentId: `document-${index + 1}`,
  localId: `local-${index + 1}`,
  name: `Note ${index + 1}`,
}));

// At the 36px desktop pitch with an 8-row overscan, 720px asks for row 12 and
// 1080px for row 22.
function scrollItemTable(view: RenderResult, scrollTop: number) {
  const frame = view.container.querySelector(".explorer-item-table-wrap");
  if (!(frame instanceof HTMLElement)) {
    throw new Error("Expected the explorer item table frame.");
  }
  frame.scrollTop = scrollTop;
  fireEvent.scroll(frame);
}

function renderPagedContainerDetail() {
  const { documentQueries, pending } = createDeferredDocumentQueries();
  const view = render(
    containerDetailElement(renderContainerDetail({ documentQueries })),
  );
  const settleWindowAt = (offset: number) => {
    expect(pending.map((request) => request.offset)).toEqual([offset]);
    return settlePendingItemWindow(pending, {
      rows: pagedNoteRows.slice(offset, offset + 24),
      totalCount: pagedNoteRows.length,
    });
  };
  const noteRowElement = (index: number) =>
    view.getByRole("button", { name: `Note ${index}` }).closest("tr");
  return { noteRowElement, pending, settleWindowAt, view };
}

test("scrolling to the next window keeps the served rows mounted until it lands", async () => {
  const { noteRowElement, settleWindowAt, view } = renderPagedContainerDetail();
  await settleWindowAt(0);
  const sharedRow = noteRowElement(13);

  scrollItemTable(view, 720);

  // The list must not blank while the next window loads: the rows fetched for
  // offset 0 stay mounted where they were.
  expect(noteRowElement(1)).toBeTruthy();
  expect(noteRowElement(13)).toBe(sharedRow);

  await settleWindowAt(12);
  expect(view.queryByRole("button", { name: "Note 1" })).toBeNull();
  expect(noteRowElement(36)).toBeTruthy();
  // A row in both windows keeps its element, so the hover under a stationary
  // pointer survives the window shift.
  expect(noteRowElement(13)).toBe(sharedRow);
});

test("a failed next window reports its error while the served rows stay", async () => {
  const { noteRowElement, pending, settleWindowAt, view } =
    renderPagedContainerDetail();
  await settleWindowAt(0);

  scrollItemTable(view, 720);
  const request = pending.shift();
  expect(request?.offset).toBe(12);
  await act(async () => {
    request?.reject(new Error("window exploded"));
  });

  // The served rows still occupy the table, so its own error row cannot show;
  // the failure must still be visible wherever the list is scrolled.
  expect(view.getByText("window exploded")).toBeTruthy();
  expect(noteRowElement(1)).toBeTruthy();

  // The next request must not drop the line while it runs: the line's height
  // sizes the scroll frame, so hiding it re-derives the window limit and loops
  // a persistent failure through refetches. Only a load that succeeds clears it.
  scrollItemTable(view, 1080);
  expect(view.getByText("window exploded")).toBeTruthy();
  await settleWindowAt(22);
  expect(view.queryByText("window exploded")).toBeNull();
});

test("an active import in this container shows the status line and a working cancel", async () => {
  const { documentQueries, pending } = createDeferredDocumentQueries();
  const cancelledContainerIds: string[] = [];
  const runningUploadManager: ExplorerUploadManager = {
    ...idleUploadManager,
    cancelForContainer: (containerId) => {
      cancelledContainerIds.push(containerId);
    },
    isImporting: true,
    run: {
      containerId: containerA.id,
      error: null,
      progress: {
        completedCount: 1,
        failedCount: 0,
        importedCount: 1,
        totalCount: 3,
      },
      status: "running",
    },
  };
  const props = renderContainerDetail({ documentQueries });
  const view = render(
    containerDetailElement({ ...props, uploadManager: runningUploadManager }),
  );
  await settlePendingItemWindow(pending, { rows: [], totalCount: 0 });

  expect(view.getByText("Importing 1/3 files...")).toBeTruthy();
  fireEvent.click(
    view.getByRole("button", { name: EXPLORER_LABELS.fileImportCancelAction }),
  );
  // The button cancels for THIS container, never the global queue.
  expect(cancelledContainerIds).toEqual([containerA.id]);

  // The same run must NOT surface in a different container's detail panel.
  view.rerender(
    containerDetailElement({
      ...props,
      selectedNode: containerB,
      uploadManager: runningUploadManager,
    }),
  );
  expect(view.queryByText("Importing 1/3 files...")).toBeNull();
  expect(
    view.queryByRole("button", {
      name: EXPLORER_LABELS.fileImportCancelAction,
    }),
  ).toBeNull();
});

test("a narrow item list frame folds the rows onto two lines", async () => {
  // A wide viewport in the windowed layout: only the frame's own width is
  // narrow, which is the case a viewport media query cannot see.
  mockFrameWidth(320);
  const { documentQueries, pending } = createDeferredDocumentQueries();
  const props = renderContainerDetail({ documentQueries });
  const view = render(containerDetailElement(props));

  await settlePendingItemWindow(pending, {
    rows: [alphaNoteRow],
    totalCount: 1,
  });

  const frame = view.container.querySelector(".explorer-item-table-wrap");
  if (!(frame instanceof HTMLElement)) {
    throw new Error("Expected the explorer item table frame.");
  }

  expect(frame.classList.contains("mini-app-table-frame--two-line")).toBe(true);
  expect(frame.style.getPropertyValue("--mini-app-virtual-row-height")).toBe(
    "56px",
  );
  expect(
    view.container.querySelector("tbody .explorer-item-summary"),
  ).not.toBeNull();
  // The name button — the selector the screenshot and dual-pane suites rely on
  // — survives the fold.
  expect(view.getByRole("button", { name: alphaNoteRow.name })).toBeTruthy();
  // The kebab rides every layout, so a folded windowed pane keeps the summary
  // column and the actions column beside it.
  expect(
    view.getByRole("button", {
      name: `${EXPLORER_LABELS.itemActionsButtonPrefix} ${alphaNoteRow.name}`,
    }),
  ).toBeTruthy();
  expect(view.container.querySelectorAll("thead th")).toHaveLength(2);
});

test("a wide item list frame keeps the single-line columns", async () => {
  mockFrameWidth(900);
  const { documentQueries, pending } = createDeferredDocumentQueries();
  const props = renderContainerDetail({ documentQueries });
  const view = render(containerDetailElement(props));

  await settlePendingItemWindow(pending, {
    rows: [alphaNoteRow],
    totalCount: 1,
  });

  const frame = view.container.querySelector(".explorer-item-table-wrap");
  if (!(frame instanceof HTMLElement)) {
    throw new Error("Expected the explorer item table frame.");
  }

  expect(frame.classList.contains("mini-app-table-frame--two-line")).toBe(
    false,
  );
  expect(frame.style.getPropertyValue("--mini-app-virtual-row-height")).toBe(
    "36px",
  );
  expect(
    view.container.querySelector("tbody .explorer-item-summary"),
  ).toBeNull();
});

test("an unmeasured frame leaves the pitch alone, so the window query runs once", async () => {
  // The guard that keeps this change inert wherever there is no layout: a width
  // of 0 must not fold, and must not move the pitch and re-issue the query.
  const { documentQueries, pending } = createDeferredDocumentQueries();
  const props = renderContainerDetail({ documentQueries });
  const view = render(containerDetailElement(props));

  await settlePendingItemWindow(pending, {
    rows: [alphaNoteRow],
    totalCount: 1,
  });

  expect(pending.length).toBe(0);
  const frame = view.container.querySelector(".explorer-item-table-wrap");
  if (!(frame instanceof HTMLElement)) {
    throw new Error("Expected the explorer item table frame.");
  }
  expect(frame.classList.contains("mini-app-table-frame--two-line")).toBe(
    false,
  );
});

test.each(["kebab", "icon", "name", "touch"])(
  "the header %s opens the current folder's actions menu",
  async (trigger) => {
    const { documentQueries } = createDeferredDocumentQueries();
    const opened: string[] = [];
    const onContainerContextMenu = (_event: unknown, containerId: string) => {
      opened.push(containerId);
    };
    const props = renderContainerDetail({ documentQueries });
    const view = render(
      containerDetailElement({ ...props, onContainerContextMenu }),
    );
    const openMenu = async (node: ContainerNode) => {
      if (trigger === "kebab") {
        fireEvent.click(
          view.getByRole("button", { name: headerActionsLabel(node) }),
        );
        return;
      }
      const target =
        trigger === "icon"
          ? view.container.querySelector(".explorer-detail-header-icon")
          : view.getByText(node.name);
      if (!target) throw new Error("Expected the folder header target.");
      if (trigger === "touch") {
        fireEvent.pointerDown(target, { pointerType: "touch" });
        await act(() => new Promise((resolve) => setTimeout(resolve, 550)));
        fireEvent.pointerUp(target, { pointerType: "touch" });
      } else {
        fireEvent.contextMenu(target);
      }
    };

    await openMenu(containerA);
    expect(opened).toEqual([containerA.id]);

    // Navigating into another folder retargets the same trigger, so the menu can
    // never act on the folder you just left.
    view.rerender(
      containerDetailElement({
        ...props,
        onContainerContextMenu,
        selectedNode: containerB,
      }),
    );
    await openMenu(containerB);
    expect(opened).toEqual([containerA.id, containerB.id]);
    expect(
      view.queryByRole("button", { name: headerActionsLabel(containerA) }),
    ).toBeNull();
  },
);

// The header spreads its children apart, so the kebab shares a trailing group
// with the sync badge rather than being a third child — otherwise the badge
// strands in the middle of the header instead of sitting beside the kebab.
test("the header kebab is the trailing control, after the sync indicator", () => {
  const { documentQueries } = createDeferredDocumentQueries();
  const props = renderContainerDetail({ documentQueries });
  const view = render(
    containerDetailElement({ ...props, showHeaderSyncIndicator: true }),
  );

  const header = view.container.querySelector(".mini-app-header");
  const actions = header?.querySelector(".mini-app-actions");
  if (!header || !actions) {
    throw new Error("Expected the container header and its actions group.");
  }

  expect(actions.lastElementChild).toBe(
    view.getByRole("button", { name: headerActionsLabel(containerA) }),
  );
  expect(actions.children).toHaveLength(2);
  // The identity block and that group are the header's only children, so
  // space-between still pins the folder name left and the controls right.
  expect(header.children).toHaveLength(2);
});

test("an orphaned document renders an empty actions cell", () => {
  const view = render(
    <table>
      <tbody>
        <tr>
          {renderExplorerItemCell("actions", {
            contactAvatarUrlByLocalId: {},
            currentSelfContactLocalId: null,
            currentSigningFingerprint: null,
            currentUserId: null,
            largeRows: false,
            onItemContextMenu: () => undefined,
            online: true,
            row: { ...alphaNoteRow, containerId: null },
            selectDocumentProjection: () => undefined,
            setSelectedId: () => undefined,
          })}
        </tr>
      </tbody>
    </table>,
  );

  expect(
    view.container.querySelector(".mini-app-row-actions-cell"),
  ).toBeTruthy();
  expect(view.queryByRole("button")).toBeNull();
});
