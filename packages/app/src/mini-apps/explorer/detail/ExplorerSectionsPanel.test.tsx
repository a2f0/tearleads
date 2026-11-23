import { afterEach, expect, spyOn, test } from "bun:test";
import type {
  BlobStore,
  ContainerDocumentQueries,
  DocumentSummary,
  DomainScope,
  Tearleads,
} from "@tearleads/client-sdk";
import {
  createDomainScope,
  getOrCreateDomainSyncCoordinator,
} from "@tearleads/client-sdk";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import * as TearleadsProvider from "../../../providers/sdk/TearleadsProvider";
import type { ExplorerUploadManager } from "../hooks/useExplorerUploadManager";
import { EXPLORER_LABELS } from "../labels";
import type { ExplorerRoute } from "../routes";
import { ExplorerSectionsPanel } from "./ExplorerSectionsPanel";

afterEach(cleanup);

function createBlobStore(): BlobStore {
  return {
    deleteBytes: async () => undefined,
    openByteSource: async () => null,
    readBytes: async () => null,
    writeByteSource: async () => undefined,
    writeBytes: async () => undefined,
  };
}

function renderSectionsPanel(
  route: ExplorerRoute,
  overrides: {
    domainScope?: DomainScope;
    loadDocumentSummary?: (localId: string) => Promise<DocumentSummary | null>;
    onOpenSyncLaneDetailRoute?: (laneKey: string) => void;
    openBlobBrowserRoute?: () => void;
    openSyncLanesRoute?: () => void;
    openDocumentInfoRoute?: (localId: string, containerId: string) => void;
    openIncomingRoute?: () => void;
    openOutgoingRoute?: (options?: unknown) => void;
    selectDocumentProjection?: (localId: string, containerId: string) => void;
  } = {},
) {
  const documentQueries = {
    listPendingDownloads: async () => [],
    listPendingWrites: async () => [],
    loadDocumentSummary: overrides.loadDocumentSummary ?? (async () => null),
  } as unknown as ContainerDocumentQueries;
  const uploadManager: ExplorerUploadManager = {
    cancel: () => undefined,
    cancelForContainer: () => undefined,
    isImporting: false,
    items: [],
    queuedFileCount: 0,
    queuedFileCounts: new Map(),
    run: null,
    startImport: () => undefined,
  };
  return render(
    <ExplorerSectionsPanel
      billingBlockedOrganizationId={null}
      blobPickTarget={null}
      blobStore={createBlobStore()}
      dbReady
      documentQueries={documentQueries}
      domainScope={overrides.domainScope ?? createDomainScope()}
      isAuthenticated={true}
      loadBlobInfo={async () => ({ rows: [], totalCount: 0 })}
      nodes={[]}
      onCancelBlobPick={() => undefined}
      onOpenSyncLaneDetailRoute={
        overrides.onOpenSyncLaneDetailRoute ?? (() => undefined)
      }
      onPickBlob={() => undefined}
      online={true}
      organizationNamesById={new Map()}
      openBlobBrowserRoute={overrides.openBlobBrowserRoute ?? (() => undefined)}
      openContainerInfoRoute={() => undefined}
      openDocumentInfoRoute={
        overrides.openDocumentInfoRoute ?? (() => undefined)
      }
      openSyncLanesRoute={overrides.openSyncLanesRoute ?? (() => undefined)}
      openIncomingRoute={overrides.openIncomingRoute ?? (() => undefined)}
      openOutgoingRoute={overrides.openOutgoingRoute ?? (() => undefined)}
      openWriteQueueEntryRoute={() => undefined}
      route={route}
      selectDocumentProjection={
        overrides.selectDocumentProjection ?? (() => undefined)
      }
      uploadManager={uploadManager}
    />,
  );
}

function selectedTabs(view: ReturnType<typeof render>) {
  return view
    .getAllByRole("tab")
    .map(
      (tab) => `${tab.textContent}:${tab.getAttribute("aria-selected") ?? ""}`,
    );
}

test("the hub shows four tabs, by direction, with Sync Lanes active by default", () => {
  const view = renderSectionsPanel({ view: "selection" });

  expect(selectedTabs(view)).toEqual([
    "Sync Lanes:true",
    "Blob Browser:false",
    "Outgoing:false",
    "Incoming:false",
  ]);
});

test("the Outgoing route stacks Uploads over the Write Queue in one scroller", async () => {
  const view = renderSectionsPanel({ section: null, view: "outgoing" });

  expect(selectedTabs(view)).toEqual([
    "Sync Lanes:false",
    "Blob Browser:false",
    "Outgoing:true",
    "Incoming:false",
  ]);
  await waitFor(() =>
    expect(view.getByText(EXPLORER_LABELS.writeQueueEmpty)).toBeTruthy(),
  );
  expect(
    view
      .getAllByRole("region")
      .map((region) => region.getAttribute("aria-labelledby"))
      .map((id) => (id ? document.getElementById(id)?.textContent : null)),
  ).toEqual([EXPLORER_LABELS.uploadsTitle, EXPLORER_LABELS.writeQueueTitle]);
  expect(view.getByText(EXPLORER_LABELS.uploadsEmpty)).toBeTruthy();
  // One scroller and one header for the tab, not one per section.
  expect(
    view.container.querySelectorAll(".mini-app-panel--scroll"),
  ).toHaveLength(1);
  expect(view.container.querySelectorAll(".mini-app-header")).toHaveLength(1);
  expect(
    view.getByText(EXPLORER_LABELS.outgoingAction, { selector: "strong" }),
  ).toBeTruthy();
});

test("a write-queue entry keeps the Outgoing tab and hides the Uploads section", async () => {
  const view = renderSectionsPanel({
    entryKey: "document::missing",
    view: "write-queue-entry",
  });

  expect(selectedTabs(view)).toContain("Outgoing:true");
  await waitFor(() =>
    expect(
      view.getByText(EXPLORER_LABELS.writeQueueEntryNotQueued, {
        exact: false,
      }),
    ).toBeTruthy(),
  );
  expect(
    view.getByText(EXPLORER_LABELS.writeQueueEntryDetailTitle),
  ).toBeTruthy();
  expect(view.queryByText(EXPLORER_LABELS.uploadsEmpty)).toBeNull();
  expect(view.queryAllByRole("region")).toHaveLength(0);
});

test("the blob-browser route marks the Blob Browser tab active", async () => {
  const view = renderSectionsPanel({
    blobId: null,
    storageKey: null,
    view: "blob-browser",
  });

  await waitFor(() => {
    expect(
      view
        .getByRole("tab", { name: EXPLORER_LABELS.blobBrowserAction })
        .getAttribute("aria-selected"),
    ).toBe("true");
  });
  expect(
    view
      .getByRole("tab", { name: EXPLORER_LABELS.syncLanesAction })
      .getAttribute("aria-selected"),
  ).toBe("false");
});

test("tapping a tab navigates via the matching route opener", () => {
  const opened: string[] = [];
  const view = renderSectionsPanel(
    { view: "sync-lanes" },
    {
      openBlobBrowserRoute: () => opened.push("blobs"),
      openSyncLanesRoute: () => opened.push("sync"),
    },
  );

  fireEvent.click(
    view.getByRole("tab", { name: EXPLORER_LABELS.blobBrowserAction }),
  );
  expect(opened).toEqual(["blobs"]);
});

test("arrow keys move the active tab and navigate", () => {
  const opened: string[] = [];
  const view = renderSectionsPanel(
    { view: "sync-lanes" },
    { openBlobBrowserRoute: () => opened.push("blobs") },
  );

  fireEvent.keyDown(
    view.getByRole("tab", { name: EXPLORER_LABELS.syncLanesAction }),
    { key: "ArrowRight" },
  );
  expect(opened).toEqual(["blobs"]);
});

test("End moves selection to the last tab (Incoming)", () => {
  const opened: string[] = [];
  const view = renderSectionsPanel(
    { view: "sync-lanes" },
    { openIncomingRoute: () => opened.push("incoming") },
  );

  fireEvent.keyDown(
    view.getByRole("tab", { name: EXPLORER_LABELS.syncLanesAction }),
    { key: "End" },
  );
  expect(opened).toEqual(["incoming"]);
});

test("tapping the Outgoing tab opens it at its top", () => {
  const opened: unknown[][] = [];
  const view = renderSectionsPanel(
    { view: "sync-lanes" },
    { openOutgoingRoute: (...args: unknown[]) => opened.push(args) },
  );

  fireEvent.click(
    view.getByRole("tab", { name: EXPLORER_LABELS.outgoingAction }),
  );
  expect(opened).toEqual([[]]);
});

test("the embedded Sync Lanes panel drops the back-to-Explorer action", () => {
  const view = renderSectionsPanel({ view: "sync-lanes" });

  // The tab bar owns top-level navigation, so the list-mode back button is gone.
  expect(
    view.queryByRole("button", { name: EXPLORER_LABELS.syncLanesBackAction }),
  ).toBeNull();
});

test("Incoming opens its route and shows an empty durable queue", async () => {
  const sdk = spyOn(TearleadsProvider, "useTearleads").mockReturnValue({
    documents: { retryDownload: async () => false },
  } as unknown as Tearleads);
  try {
    const opened: string[] = [];
    const view = renderSectionsPanel(
      { view: "incoming" },
      {
        openIncomingRoute: () => opened.push("incoming"),
      },
    );
    const tab = view.getByRole("tab", { name: "Incoming" });
    expect(tab.getAttribute("aria-selected")).toBe("true");
    fireEvent.click(tab);
    expect(opened).toEqual(["incoming"]);
    await waitFor(() =>
      expect(view.getByText("No pending downloads.")).toBeTruthy(),
    );
  } finally {
    sdk.mockRestore();
  }
});

test("a document lane's Label opens the document, not its info", async () => {
  const domainScope = createDomainScope();
  const coordinator = getOrCreateDomainSyncCoordinator(domainScope);
  coordinator.registerLane("documents:local-1", {
    label: "Notes",
    run: async () => undefined,
  });
  const opened: string[] = [];
  try {
    const view = renderSectionsPanel(
      { laneKey: "documents:local-1", view: "sync-lane-detail" },
      {
        domainScope,
        loadDocumentSummary: async () =>
          ({ containerId: "folder-1", id: "local-1" }) as DocumentSummary,
        openDocumentInfoRoute: (localId, containerId) =>
          opened.push(`info ${containerId}/${localId}`),
        selectDocumentProjection: (localId, containerId) =>
          opened.push(`document ${containerId}/${localId}`),
      },
    );

    fireEvent.click(
      await view.findByRole("button", {
        name: `${EXPLORER_LABELS.syncLanesOpenDocumentAction}: Notes`,
      }),
    );

    expect(opened).toEqual(["document folder-1/local-1"]);
  } finally {
    // Unmount first, so the coordinator's disposal does not update the panel.
    cleanup();
    coordinator.dispose();
  }
});
