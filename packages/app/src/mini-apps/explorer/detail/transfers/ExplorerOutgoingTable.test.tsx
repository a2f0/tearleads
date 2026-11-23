import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent } from "@testing-library/react";
import {
  renderOutgoingView,
  rowFor,
} from "../../../../../test/helpers/explorer/outgoingViewFixtures";
import {
  ARCHIVE_NODE,
  CREATED_AT,
  item,
  operation,
  stubPhoneMatchMedia,
  upload,
  uploadManager,
} from "../../../../../test/helpers/explorer/syncPanelFixtures";
import {
  EXPLORER_LABELS,
  getExplorerWriteQueueAttachmentLabel,
  getExplorerWriteQueueMetadataUpdateLabel,
  getExplorerWriteQueueUpdateLabel,
} from "../../labels";

let restoreMatchMedia: (() => void) | null = null;

afterEach(() => {
  restoreMatchMedia?.();
  restoreMatchMedia = null;
  cleanup();
});

const kebab = (name: string) => ({
  name: `${EXPLORER_LABELS.writeQueueRowActionsLabel}: ${name}`,
});

test("renders grouped operations, organizations, bytes, and statuses", () => {
  const document = item({
    operations: [
      operation({ count: 3, kind: "update" }),
      operation({ byteLength: 2_048, count: 2, kind: "attachment" }),
    ],
  });
  const failedContainer = item({
    containerId: null,
    localId: "projects-container",
    name: "Projects",
    objectKind: "container",
    operations: [
      operation({ kind: "create" }),
      operation({
        count: 2,
        kind: "update",
        lastAttemptedAt: CREATED_AT,
        lastError: "Metadata write failed",
      }),
    ],
    organizationId: "custom-org",
    remoteId: null,
    status: "error",
  });
  const blockedContainer = item({
    containerId: null,
    localId: "blocked-container",
    name: "Blocked folder",
    objectKind: "container",
    operations: [
      operation({
        kind: "move",
        status: "blocked",
        targetContainerId: ARCHIVE_NODE.id,
      }),
    ],
    organizationId: "custom-org",
    remoteId: "blocked-container",
    status: "blocked",
  });
  const view = renderOutgoingView({
    writes: [document, failedContainer, blockedContainer],
  });

  const documentRow = rowFor(
    view.getByRole("button", { name: "Open object: Offline note" }),
  );
  expect(documentRow.textContent).toContain("Personal");
  expect(documentRow.textContent).toContain("Document · document-local-id");
  expect(documentRow.textContent).toContain(
    getExplorerWriteQueueUpdateLabel(3),
  );
  expect(documentRow.textContent).toContain(
    getExplorerWriteQueueAttachmentLabel(2, 2_048),
  );
  expect(documentRow.textContent).toContain(
    EXPLORER_LABELS.writeQueuePendingStatus,
  );

  const failedRow = rowFor(
    view.getByRole("button", { name: "Open object: Projects" }),
  );
  expect(failedRow.textContent).toContain("Acme");
  expect(failedRow.textContent).toContain(
    EXPLORER_LABELS.writeQueueCreateOperation,
  );
  expect(failedRow.textContent).toContain(
    getExplorerWriteQueueMetadataUpdateLabel(2),
  );
  expect(failedRow.textContent).toContain(
    EXPLORER_LABELS.writeQueueErrorStatus,
  );
  expect(failedRow.textContent).toContain("Metadata write failed");

  const blockedRow = rowFor(
    view.getByRole("button", { name: "Open object: Blocked folder" }),
  );
  expect(blockedRow.textContent).toContain("move to Archive");
  expect(blockedRow.textContent).toContain(
    EXPLORER_LABELS.writeQueueBlockedStatus,
  );
});

test("a file in the write queue is one row, with its upload's status and the entry's menu", () => {
  const openedEntries: string[] = [];
  const view = renderOutgoingView({
    openWriteQueueEntryRoute: (entryKey) => {
      openedEntries.push(entryKey);
    },
    uploadManager: uploadManager({
      items: [
        upload({
          fileName: "report.pdf",
          localId: "document-local-id",
          status: "imported",
        }),
      ],
    }),
    writes: [
      item({ name: "report.pdf", operations: [operation({ kind: "create" })] }),
    ],
  });

  const rows = view
    .getAllByRole("row")
    .filter((row) => row.textContent?.includes("report.pdf"));
  expect(rows).toHaveLength(1);
  const [row] = rows;
  expect(row?.textContent).toContain("Document · document-local-id · 1.0 KB");
  expect(row?.textContent).toContain(EXPLORER_LABELS.writeQueueCreateOperation);
  expect(row?.textContent).toContain(EXPLORER_LABELS.uploadsPendingSyncStatus);

  fireEvent.click(view.getByRole("button", kebab("report.pdf")));
  fireEvent.click(
    view.getByRole("button", {
      name: EXPLORER_LABELS.writeQueueEntryInfoAction,
    }),
  );
  // Routes by the full (objectKind, namespace, localId) key, not the localId.
  expect(openedEntries).toEqual(["document::document-local-id"]);
});

test("opens the document, the container, and a stored file from the row's primary tap", () => {
  const openedContainers: string[] = [];
  const openedDocuments: Array<[string, string]> = [];
  const view = renderOutgoingView({
    openContainerInfoRoute: (containerId) => {
      openedContainers.push(containerId);
    },
    openDocument: (localId, containerId) => {
      openedDocuments.push([localId, containerId]);
    },
    uploadManager: uploadManager({
      items: [
        upload({
          fileName: "done.txt",
          id: "upload-done",
          localId: "done-doc",
          status: "uploaded",
        }),
        upload({ fileName: "waiting.txt", id: "upload-waiting" }),
      ],
    }),
    writes: [
      item(),
      item({
        containerId: null,
        localId: "projects-container",
        name: "Projects",
        objectKind: "container",
        organizationId: "custom-org",
        remoteId: null,
      }),
    ],
  });

  fireEvent.click(
    view.getByRole("button", { name: "Open object: Offline note" }),
  );
  fireEvent.click(view.getByRole("button", { name: "Open object: Projects" }));
  fireEvent.click(view.getByRole("button", { name: "Open object: done.txt" }));
  // A file not imported yet has no document to open.
  expect(
    view.queryByRole("button", { name: "Open object: waiting.txt" }),
  ).toBeNull();

  expect(openedDocuments).toEqual([
    ["document-local-id", "documents-container"],
    ["done-doc", "documents-container"],
  ]);
  expect(openedContainers).toEqual(["projects-container"]);
});

// Edge-case row 13: a failure-only revalidation item carries no local data,
// so the destructive "Discard local edits" (which deletes durable history)
// must not be offered for it — while an item with real queued writes keeps
// the escape hatch.
test("revalidation-only items do not offer the destructive discard", () => {
  const view = renderOutgoingView({
    writes: [
      item({
        localId: "revalidating-doc",
        name: "Stale note",
        operations: [
          operation({
            count: 0,
            kind: "revalidation",
            lastError:
              "Remote revalidation failed: container unavailable (409)",
          }),
        ],
        status: "error",
      }),
      item(),
    ],
  });

  fireEvent.click(view.getByRole("button", kebab("Stale note")));
  expect(
    view.queryByRole("button", {
      name: EXPLORER_LABELS.writeQueueDiscardAction,
    }),
  ).toBeNull();
  fireEvent.keyDown(document.body, { key: "Escape" });

  fireEvent.click(view.getByRole("button", kebab("Offline note")));
  expect(
    view.getByRole("button", {
      name: EXPLORER_LABELS.writeQueueDiscardAction,
    }),
  ).toBeTruthy();
});

test("a file with nothing queued has no write-queue menu", () => {
  const view = renderOutgoingView({
    uploadManager: uploadManager({ items: [upload({ status: "importing" })] }),
  });

  expect(view.getByText(EXPLORER_LABELS.uploadsImportingStatus)).toBeTruthy();
  expect(view.getByText("File · 1.0 KB")).toBeTruthy();
  expect(view.queryByRole("button", kebab("a.txt"))).toBeNull();
});

test("uses a compact object and status table on phones", () => {
  restoreMatchMedia = stubPhoneMatchMedia();
  const view = renderOutgoingView({
    writes: [
      item({
        operations: [operation({ byteLength: 2_048, kind: "attachment" })],
      }),
    ],
  });

  const headers = Array.from(view.container.querySelectorAll("thead th"));
  expect(headers.map((header) => header.textContent)).toEqual([
    EXPLORER_LABELS.writeQueueObjectColumn,
    EXPLORER_LABELS.writeQueueStatusColumn,
    EXPLORER_LABELS.writeQueueRowActionsLabel,
  ]);
  // The pending writes move under the object's name.
  expect(
    view.getByText(getExplorerWriteQueueAttachmentLabel(1, 2_048)),
  ).toBeTruthy();
  expect(
    (
      view.getByRole("table", {
        name: EXPLORER_LABELS.outgoingAction,
      }) as HTMLElement
    ).style.minWidth,
  ).toBe("");
});

test("bounds large lists until more rows are requested", () => {
  const writes = Array.from({ length: 60 }, (_, index) =>
    item({
      localId: `document-${index}`,
      name: `Document ${index}`,
      remoteId: `remote-document-${index}`,
    }),
  );
  const items = Array.from({ length: 41 }, (_, index) =>
    upload({ fileName: `file-${index}.txt`, id: `upload-${index}` }),
  );
  const view = renderOutgoingView({
    uploadManager: uploadManager({ items }),
    writes,
  });
  expect(view.getAllByText(/^(file-\d+\.txt|Document \d+)$/).length).toBe(100);
  fireEvent.click(
    view.getByRole("button", { name: EXPLORER_LABELS.outgoingShowMoreAction }),
  );
  expect(view.getAllByText(/^(file-\d+\.txt|Document \d+)$/).length).toBe(101);
});

test("a failed upload announces its status with the error beneath", () => {
  const view = renderOutgoingView({
    uploadManager: uploadManager({
      items: [
        upload({ error: "read failed", status: "failed" }),
        upload({ fileName: "b.txt", id: "upload-2", status: "removed" }),
      ],
    }),
  });

  expect(view.getByRole("alert").textContent).toBe(
    EXPLORER_LABELS.uploadsFailedStatus,
  );
  expect(view.getByText("read failed")).toBeTruthy();
  // A document deleted before its upload settled is not a failure.
  expect(view.getByText(EXPLORER_LABELS.uploadsRemovedStatus)).toBeTruthy();
});
