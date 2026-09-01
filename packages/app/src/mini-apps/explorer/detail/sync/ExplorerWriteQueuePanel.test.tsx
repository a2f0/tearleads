import { afterEach, expect, test } from "bun:test";
import type {
  ContainerDocumentQueries,
  ContainerNode,
  PendingWriteQueueItem,
  PendingWriteQueueOperation,
} from "@tearleads/client-sdk";
import {
  createDomainScope,
  getDomainSyncCoordinatorSnapshot,
  getOrCreateDomainSyncCoordinator,
  syncedContainerDocumentObjectSyncState,
} from "@tearleads/client-sdk";
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react";
import type { ComponentProps } from "react";
import {
  EXPLORER_LABELS,
  getExplorerWriteQueueAttachmentLabel,
  getExplorerWriteQueueMetadataUpdateLabel,
  getExplorerWriteQueueSummaryLabel,
  getExplorerWriteQueueUpdateLabel,
} from "../../labels";
import {
  ExplorerWriteQueuePanel,
  ExplorerWriteQueuePanelView,
} from "./ExplorerWriteQueuePanel";

let restoreMatchMedia: (() => void) | null = null;

afterEach(() => {
  restoreMatchMedia?.();
  restoreMatchMedia = null;
  cleanup();
});

function usePhoneViewport() {
  const originalMatchMedia = window.matchMedia;
  restoreMatchMedia = () => {
    window.matchMedia = originalMatchMedia;
  };
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

const CREATED_AT = "2026-07-16T12:00:00.000Z";

function operation(
  overrides: Partial<PendingWriteQueueOperation> = {},
): PendingWriteQueueOperation {
  return {
    byteLength: 0,
    count: 1,
    createdAt: CREATED_AT,
    kind: "update",
    lastAttemptedAt: null,
    lastError: null,
    status: "pending",
    targetContainerId: null,
    updatedAt: CREATED_AT,
    ...overrides,
  };
}

function item(
  overrides: Partial<PendingWriteQueueItem> = {},
): PendingWriteQueueItem {
  return {
    containerId: "documents-container",
    createdAt: CREATED_AT,
    localId: "document-local-id",
    name: "Offline note",
    namespace: null,
    objectKind: "document",
    operations: [operation()],
    organizationId: "personal-org",
    remoteId: "document-remote-id",
    status: "pending",
    updatedAt: CREATED_AT,
    ...overrides,
  };
}

const ARCHIVE_NODE = {
  id: "archive-container",
  kind: "container",
  name: "Archive",
  organizationId: "custom-org",
  parentId: null,
  syncState: syncedContainerDocumentObjectSyncState,
} satisfies ContainerNode;

const EMPTY_SNAPSHOT = getDomainSyncCoordinatorSnapshot(createDomainScope());

type ViewProps = ComponentProps<typeof ExplorerWriteQueuePanelView>;

function renderPanel(overrides: Partial<ViewProps> = {}) {
  const props: ViewProps = {
    billingBlockedOrganizationId: null,
    discardPendingWrites: () => undefined,
    error: false,
    isAuthenticated: true,
    items: [],
    loading: false,
    nodes: [ARCHIVE_NODE],
    online: true,
    openContainerInfoRoute: () => undefined,
    openDocument: () => undefined,
    retryPendingWrites: () => undefined,
    openWriteQueueEntryRoute: () => undefined,
    organizationNamesById: new Map([
      ["custom-org", "Acme"],
      ["personal-org", "Personal"],
    ]),
    selectedEntryKey: null,
    snapshot: EMPTY_SNAPSHOT,
    ...overrides,
  };

  return render(<ExplorerWriteQueuePanelView {...props} />);
}

function renderPanelLoader(
  documentQueries: ContainerDocumentQueries,
  domainScope = createDomainScope(),
) {
  return render(
    <ExplorerWriteQueuePanel
      billingBlockedOrganizationId={null}
      documentListRevision={0}
      documentQueries={documentQueries}
      domainScope={domainScope}
      isAuthenticated={true}
      nodes={[ARCHIVE_NODE]}
      online={true}
      openContainerInfoRoute={() => undefined}
      openDocument={() => undefined}
      openWriteQueueEntryRoute={() => undefined}
      organizationNamesById={new Map()}
      selectedEntryKey={null}
    />,
  );
}

function rowForButton(button: HTMLElement): HTMLTableRowElement {
  const row = button.closest("tr");
  if (!(row instanceof HTMLTableRowElement)) {
    throw new Error("Expected the queue object button to be inside a row.");
  }
  return row;
}

test("renders grouped operations, organizations, counts, bytes, and statuses", () => {
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
  const view = renderPanel({
    items: [document, failedContainer, blockedContainer],
  });

  expect(
    view.getByText(
      getExplorerWriteQueueSummaryLabel({ objectCount: 3, writeCount: 9 }),
    ),
  ).toBeTruthy();

  const documentRow = rowForButton(
    view.getByRole("button", { name: "Open object: Offline note" }),
  );
  expect(documentRow.textContent).toContain("Personal");
  expect(documentRow.textContent).toContain(
    getExplorerWriteQueueUpdateLabel(3),
  );
  expect(documentRow.textContent).toContain(
    getExplorerWriteQueueAttachmentLabel(2, 2_048),
  );
  expect(documentRow.textContent).toContain(
    EXPLORER_LABELS.writeQueuePendingStatus,
  );

  const failedRow = rowForButton(
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

  const blockedRow = rowForButton(
    view.getByRole("button", { name: "Open object: Blocked folder" }),
  );
  expect(blockedRow.textContent).toContain("move to Archive");
  expect(blockedRow.textContent).toContain(
    EXPLORER_LABELS.writeQueueBlockedStatus,
  );
});

test("shows offline, signed-out, and organization-scoped billing blockers", () => {
  const view = renderPanel({
    billingBlockedOrganizationId: "custom-org",
    isAuthenticated: false,
    items: [
      item(),
      item({
        localId: "custom-document",
        name: "Custom note",
        organizationId: "custom-org",
        remoteId: "custom-document-remote",
      }),
    ],
    online: false,
  });

  const blockers = view.getByRole("status");
  expect(blockers.textContent).toContain(
    EXPLORER_LABELS.writeQueueWaitingForNetwork,
  );
  expect(blockers.textContent).toContain(EXPLORER_LABELS.writeQueueSignedOut);
  expect(blockers.textContent).toContain(
    EXPLORER_LABELS.writeQueueBillingPausedMessage,
  );
  expect(blockers.textContent).toContain("Acme");

  const personalRow = rowForButton(
    view.getByRole("button", { name: "Open object: Offline note" }),
  );
  const customRow = rowForButton(
    view.getByRole("button", { name: "Open object: Custom note" }),
  );
  expect(personalRow.textContent).not.toContain(
    EXPLORER_LABELS.writeQueueBillingPaused,
  );
  expect(customRow.textContent).toContain(
    EXPLORER_LABELS.writeQueueBillingPaused,
  );
});

test("opens the document and container from the row's primary tap", () => {
  const openedContainers: string[] = [];
  const openedDocuments: Array<[string, string]> = [];
  const view = renderPanel({
    items: [
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
    openContainerInfoRoute: (containerId) => {
      openedContainers.push(containerId);
    },
    openDocument: (localId, containerId) => {
      openedDocuments.push([localId, containerId]);
    },
  });

  fireEvent.click(
    view.getByRole("button", { name: "Open object: Offline note" }),
  );
  fireEvent.click(view.getByRole("button", { name: "Open object: Projects" }));

  expect(openedDocuments).toEqual([
    ["document-local-id", "documents-container"],
  ]);
  expect(openedContainers).toEqual(["projects-container"]);
});

test("drills into an entry's sync detail from the row kebab", () => {
  const openedEntries: string[] = [];
  const view = renderPanel({
    items: [item()],
    openWriteQueueEntryRoute: (entryKey) => {
      openedEntries.push(entryKey);
    },
  });

  // The kebab names its row so screen readers can tell the rows apart.
  fireEvent.click(
    view.getByRole("button", {
      name: `${EXPLORER_LABELS.writeQueueRowActionsLabel}: Offline note`,
    }),
  );
  fireEvent.click(
    view.getByRole("button", {
      name: EXPLORER_LABELS.writeQueueEntryInfoAction,
    }),
  );

  // Routes by the full (objectKind, namespace, localId) key, not the localId.
  expect(openedEntries).toEqual(["document::document-local-id"]);
});

test("discard runs only after an explicit confirmation", () => {
  const discarded: string[] = [];
  const view = renderPanel({
    discardPendingWrites: (queueItem) => {
      discarded.push(queueItem.localId);
    },
    items: [item()],
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

// Edge-case row 13: a failure-only revalidation item carries no local data,
// so the destructive "Discard local edits" (which deletes durable history)
// must not be offered for it — while an item with real queued writes keeps
// the escape hatch.
test("revalidation-only items do not offer the destructive discard", () => {
  const view = renderPanel({
    items: [
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

  fireEvent.click(
    view.getByRole("button", {
      name: `${EXPLORER_LABELS.writeQueueRowActionsLabel}: Stale note`,
    }),
  );
  expect(
    view.queryByRole("button", {
      name: EXPLORER_LABELS.writeQueueDiscardAction,
    }),
  ).toBeNull();
  fireEvent.keyDown(document.body, { key: "Escape" });

  fireEvent.click(
    view.getByRole("button", {
      name: `${EXPLORER_LABELS.writeQueueRowActionsLabel}: Offline note`,
    }),
  );
  expect(
    view.getByRole("button", {
      name: EXPLORER_LABELS.writeQueueDiscardAction,
    }),
  ).toBeTruthy();
});

test("explains why an errored entry is stuck in its detail view", () => {
  const view = renderPanel({
    items: [
      item({
        operations: [
          operation({
            kind: "update",
            lastAttemptedAt: CREATED_AT,
            lastError: "Manifest write rejected",
          }),
        ],
        status: "error",
      }),
    ],
    selectedEntryKey: "document::document-local-id",
  });

  expect(
    view.getByText(EXPLORER_LABELS.writeQueueEntryReasonHeading),
  ).toBeTruthy();
  expect(
    view.getByText(
      `${EXPLORER_LABELS.writeQueueEntryReasonErrorPrefix} Manifest write rejected`,
    ),
  ).toBeTruthy();
  expect(
    view.getByText(EXPLORER_LABELS.writeQueueEntryOperationsHeading),
  ).toBeTruthy();
  // The list summary is replaced by the entry title while drilled in.
  expect(
    view.getByText(EXPLORER_LABELS.writeQueueEntryDetailTitle),
  ).toBeTruthy();
});

test("reports an entry that has left the queue", () => {
  const view = renderPanel({
    items: [],
    selectedEntryKey: "document::document-local-id",
  });

  expect(view.getByText(EXPLORER_LABELS.writeQueueEntryNotQueued)).toBeTruthy();
});

test("surfaces a read failure instead of claiming the entry finished", () => {
  const view = renderPanel({
    error: true,
    items: [],
    selectedEntryKey: "document::document-local-id",
  });

  expect(view.getByText(EXPLORER_LABELS.writeQueueFailedToLoad)).toBeTruthy();
  expect(view.getByRole("alert")).toBeTruthy();
  expect(view.queryByText(EXPLORER_LABELS.writeQueueEntryNotQueued)).toBeNull();
});

test("uses a compact object and status table on phones", () => {
  usePhoneViewport();
  const view = renderPanel({
    items: [
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
  expect(
    view.getByText(getExplorerWriteQueueAttachmentLabel(1, 2_048)),
  ).toBeTruthy();
  expect(
    (
      view.getByRole("table", {
        name: EXPLORER_LABELS.writeQueueTitle,
      }) as HTMLElement
    ).style.minWidth,
  ).toBe("");
});

test("bounds large queues until more rows are requested", () => {
  const items = Array.from({ length: 101 }, (_, index) =>
    item({
      localId: `document-${index}`,
      name: `Document ${index}`,
      remoteId: `remote-document-${index}`,
    }),
  );
  const view = renderPanel({ items });

  expect(view.getAllByRole("button", { name: /^Open object:/ }).length).toBe(
    100,
  );
  fireEvent.click(
    view.getByRole("button", {
      name: EXPLORER_LABELS.writeQueueShowMoreAction,
    }),
  );
  expect(view.getAllByRole("button", { name: /^Open object:/ }).length).toBe(
    101,
  );
});

test("renders the empty state", () => {
  const view = renderPanel();

  expect(view.getByText(EXPLORER_LABELS.writeQueueEmpty)).toBeTruthy();
});

test("renders the initial loading state without a manual action", () => {
  const view = renderPanel({ loading: true });

  expect(view.getByText(EXPLORER_LABELS.writeQueueLoading)).toBeTruthy();
  expect(view.queryByRole("button")).toBeNull();
});

test("renders the load error state", () => {
  const view = renderPanel({ error: true });

  expect(view.getByText(EXPLORER_LABELS.writeQueueFailedToLoad)).toBeTruthy();
});

test("reloads a settled write while another sync lane remains active", async () => {
  let queryCount = 0;
  let pendingItems: ReadonlyArray<PendingWriteQueueItem> = [item()];
  const domainScope = createDomainScope();
  const documentQueries = {
    listPendingWrites: async () => {
      queryCount += 1;
      return pendingItems;
    },
  } as unknown as ContainerDocumentQueries;
  const coordinator = getOrCreateDomainSyncCoordinator(domainScope);
  const activeUpload = coordinator.beginUploadLane("write-queue-active-upload");
  const lane = coordinator.registerLane("write-queue-settlement-test", {
    run: async () => {
      pendingItems = [];
    },
  });
  const view = renderPanelLoader(documentQueries, domainScope);

  expect(
    await view.findByRole("button", { name: "Open object: Offline note" }),
  ).toBeTruthy();
  await act(async () => {
    lane.requestSync();
  });

  try {
    await waitFor(() => {
      expect(queryCount).toBeGreaterThanOrEqual(2);
      expect(view.getByText(EXPLORER_LABELS.writeQueueEmpty)).toBeTruthy();
    });
    const snapshot = getDomainSyncCoordinatorSnapshot(domainScope);
    expect(snapshot.hasPendingWork).toBe(true);
    expect(
      snapshot.lanes.find(
        (snapshotLane) => snapshotLane.key === "write-queue-active-upload",
      )?.running,
    ).toBe(true);
  } finally {
    await act(async () => {
      activeUpload.complete();
    });
  }
});

test("surfaces a durable-write query failure", async () => {
  const documentQueries = {
    listPendingWrites: async () => {
      throw new Error("database unavailable");
    },
  } as unknown as ContainerDocumentQueries;
  const view = renderPanelLoader(documentQueries);

  expect(
    await view.findByText(EXPLORER_LABELS.writeQueueFailedToLoad),
  ).toBeTruthy();
  expect(view.getByRole("alert")).toBeTruthy();
});
