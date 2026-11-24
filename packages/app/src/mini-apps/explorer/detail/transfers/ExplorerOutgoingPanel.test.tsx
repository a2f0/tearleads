import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent } from "@testing-library/react";
import {
  renderOutgoingView,
  rowFor,
} from "../../../../../test/helpers/explorer/outgoingViewFixtures";
import {
  item,
  operation,
  upload,
  uploadManager,
} from "../../../../../test/helpers/explorer/syncPanelFixtures";
import {
  EXPLORER_LABELS,
  getExplorerWriteQueueSummaryLabel,
} from "../../labels";

afterEach(cleanup);

test("one table lists queued writes and this session's files", () => {
  const view = renderOutgoingView({
    uploadManager: uploadManager({
      items: [
        upload({ fileName: "first.txt", id: "upload-1", status: "cancelled" }),
        upload({
          fileName: "second.txt",
          id: "upload-2",
          localId: "document-local-id",
          status: "imported",
        }),
        upload({ fileName: "third.txt", id: "upload-3", status: "importing" }),
      ],
    }),
    writes: [
      item({
        operations: [
          operation({ count: 3, kind: "update" }),
          operation({ byteLength: 2_048, count: 2, kind: "attachment" }),
        ],
      }),
      item({ localId: "edited-note", name: "Edited note" }),
    ],
  });

  expect(view.getAllByRole("table")).toHaveLength(1);
  // 2 entries with 6 writes; 3 files, 2 still moving (importing + imported).
  expect(
    view.getByText(
      `${getExplorerWriteQueueSummaryLabel({ objectCount: 2, writeCount: 6 })} · 3 files · 2 in progress`,
    ),
  ).toBeTruthy();
  const names = view
    .getAllByRole("row")
    .map((row) => row.textContent ?? "")
    .join("\n");
  // Files importing lead, the queue (with second.txt joined) follows, and
  // finished files trail.
  for (const [earlier, later] of [
    ["third.txt", "second.txt"],
    ["second.txt", "Edited note"],
    ["Edited note", "first.txt"],
  ] as const) {
    expect(names.indexOf(earlier)).toBeLessThan(names.indexOf(later));
  }
  expect(names).not.toContain("Offline note");
});

test("shows offline, signed-out, and organization-scoped billing blockers", () => {
  const view = renderOutgoingView({
    billingBlockedOrganizationId: "custom-org",
    isAuthenticated: false,
    online: false,
    writes: [
      item(),
      item({
        localId: "custom-document",
        name: "Custom note",
        organizationId: "custom-org",
        remoteId: "custom-document-remote",
      }),
    ],
  });

  const blockers = view
    .getAllByRole("status")
    .find((status) =>
      status.textContent?.includes(EXPLORER_LABELS.writeQueueWaitingForNetwork),
    );
  expect(blockers?.textContent).toContain(EXPLORER_LABELS.writeQueueSignedOut);
  expect(blockers?.textContent).toContain(
    EXPLORER_LABELS.writeQueueBillingPausedMessage,
  );
  expect(blockers?.textContent).toContain("Acme");

  const personalRow = rowFor(
    view.getByRole("button", { name: "Open object: Offline note" }),
  );
  const customRow = rowFor(
    view.getByRole("button", { name: "Open object: Custom note" }),
  );
  expect(personalRow.textContent).not.toContain(
    EXPLORER_LABELS.writeQueueBillingPaused,
  );
  expect(customRow.textContent).toContain(
    EXPLORER_LABELS.writeQueueBillingPaused,
  );
});

test("an active run shows the global status line with a working cancel", () => {
  let cancelCount = 0;
  const view = renderOutgoingView({
    uploadManager: uploadManager({
      cancel: () => {
        cancelCount += 1;
      },
      isImporting: true,
      items: [upload({ status: "importing" })],
      run: {
        containerId: "documents-container",
        error: null,
        progress: {
          completedCount: 0,
          failedCount: 0,
          importedCount: 0,
          totalCount: 1,
        },
        status: "running",
      },
    }),
  });

  expect(view.getByText("Importing 0/1 files...")).toBeTruthy();
  fireEvent.click(
    view.getByRole("button", { name: EXPLORER_LABELS.fileImportCancelAction }),
  );
  expect(cancelCount).toBe(1);
});

test("discard runs only after an explicit confirmation", () => {
  const discarded: string[] = [];
  const view = renderOutgoingView({
    discardPendingWrites: (queueItem) => {
      discarded.push(queueItem.localId);
    },
    writes: [item()],
  });
  const openRowMenu = () =>
    fireEvent.click(
      view.getByRole("button", {
        name: `${EXPLORER_LABELS.writeQueueRowActionsLabel}: Offline note`,
      }),
    );

  // The menu item only opens the dialog; nothing is discarded yet.
  openRowMenu();
  fireEvent.click(
    view.getByRole("button", { name: EXPLORER_LABELS.writeQueueDiscardAction }),
  );
  expect(discarded).toEqual([]);
  expect(
    view.getByText(EXPLORER_LABELS.writeQueueDiscardConfirmTitle),
  ).toBeTruthy();

  // Cancel closes without discarding — a mis-tap must destroy nothing.
  fireEvent.click(view.getByRole("button", { name: "Cancel" }));
  expect(
    view.queryByText(EXPLORER_LABELS.writeQueueDiscardConfirmTitle),
  ).toBeNull();
  expect(discarded).toEqual([]);

  // Confirming is what runs the destructive callback. The menu closed when
  // the dialog opened, so the only control with the action's label left is
  // the dialog's own confirm button.
  openRowMenu();
  fireEvent.click(
    view.getByRole("button", { name: EXPLORER_LABELS.writeQueueDiscardAction }),
  );
  fireEvent.click(
    view.getByRole("button", { name: EXPLORER_LABELS.writeQueueDiscardAction }),
  );
  expect(discarded).toEqual(["document-local-id"]);
  expect(
    view.queryByText(EXPLORER_LABELS.writeQueueDiscardConfirmTitle),
  ).toBeNull();
});

test("an entry's detail replaces the table", () => {
  const view = renderOutgoingView({
    selectedEntryKey: "document::document-local-id",
    uploadManager: uploadManager({ items: [upload()] }),
    writes: [item()],
  });

  expect(view.queryByRole("table")).toBeNull();
  expect(
    view.getByText(EXPLORER_LABELS.writeQueueEntryReasonHeading),
  ).toBeTruthy();
});

test("renders the empty state", () => {
  const view = renderOutgoingView();

  expect(view.getByText(EXPLORER_LABELS.outgoingEmpty)).toBeTruthy();
});

test("renders the initial loading state without a manual action", () => {
  const view = renderOutgoingView({ loading: true });

  expect(view.getByText(EXPLORER_LABELS.writeQueueLoading)).toBeTruthy();
  expect(view.getByText(EXPLORER_LABELS.writeQueueSummaryLoading)).toBeTruthy();
  expect(view.queryByRole("button")).toBeNull();
});

test("renders the load error in place of the rows, or above this session's files", () => {
  const error = "Local database schema is obsolete";
  const empty = renderOutgoingView({ error });
  expect(empty.getByRole("alert").textContent).toBe(
    `${EXPLORER_LABELS.writeQueueFailedToLoad} ${error}`,
  );
  expect(empty.queryByText(EXPLORER_LABELS.outgoingEmpty)).toBeNull();
  empty.unmount();

  const withFiles = renderOutgoingView({
    error,
    uploadManager: uploadManager({ items: [upload({ status: "uploaded" })] }),
  });
  expect(withFiles.getByRole("alert").textContent).toBe(
    `${EXPLORER_LABELS.writeQueueFailedToLoad} ${error}`,
  );
  expect(withFiles.getByText("a.txt")).toBeTruthy();
  expect(
    withFiles.getByText(
      `${EXPLORER_LABELS.writeQueueSummaryUnavailable} · 1 file`,
    ),
  ).toBeTruthy();
});
