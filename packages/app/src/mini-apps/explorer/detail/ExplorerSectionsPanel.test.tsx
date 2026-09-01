import { afterEach, expect, test } from "bun:test";
import type {
  BlobStore,
  ContainerDocumentQueries,
} from "@tearleads/client-sdk";
import { createDomainScope } from "@tearleads/client-sdk";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
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
    onOpenSyncLaneDetailRoute?: (laneKey: string) => void;
    openBlobBrowserRoute?: () => void;
    openSyncLanesRoute?: () => void;
    openUploadsRoute?: () => void;
    openWriteQueueRoute?: () => void;
  } = {},
) {
  const documentQueries = {
    listPendingWrites: async () => [],
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
      documentListRevision={0}
      documentQueries={documentQueries}
      domainScope={createDomainScope()}
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
      openDocumentInfoRoute={() => undefined}
      openSyncLanesRoute={overrides.openSyncLanesRoute ?? (() => undefined)}
      openUploadsRoute={overrides.openUploadsRoute ?? (() => undefined)}
      openWriteQueueRoute={overrides.openWriteQueueRoute ?? (() => undefined)}
      openWriteQueueEntryRoute={() => undefined}
      route={route}
      selectDocumentProjection={() => undefined}
      uploadManager={uploadManager}
    />,
  );
}

test("the default route shows all diagnostics tabs with Sync Lanes active", () => {
  const view = renderSectionsPanel({ view: "selection" });

  expect(
    view
      .getByRole("tab", { name: EXPLORER_LABELS.syncLanesAction })
      .getAttribute("aria-selected"),
  ).toBe("true");
  expect(
    view
      .getByRole("tab", { name: EXPLORER_LABELS.blobBrowserAction })
      .getAttribute("aria-selected"),
  ).toBe("false");
  expect(
    view
      .getByRole("tab", { name: EXPLORER_LABELS.writeQueueAction })
      .getAttribute("aria-selected"),
  ).toBe("false");
});

test("the write-queue route marks the Write Queue tab active", async () => {
  const view = renderSectionsPanel({ view: "write-queue" });

  await waitFor(() => {
    expect(
      view
        .getByRole("tab", { name: EXPLORER_LABELS.writeQueueAction })
        .getAttribute("aria-selected"),
    ).toBe("true");
  });
  expect(
    view
      .getByRole("tab", { name: EXPLORER_LABELS.syncLanesAction })
      .getAttribute("aria-selected"),
  ).toBe("false");
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

test("End moves selection to the last tab (Uploads)", () => {
  const opened: string[] = [];
  const view = renderSectionsPanel(
    { view: "sync-lanes" },
    { openUploadsRoute: () => opened.push("uploads") },
  );

  fireEvent.keyDown(
    view.getByRole("tab", { name: EXPLORER_LABELS.syncLanesAction }),
    { key: "End" },
  );
  expect(opened).toEqual(["uploads"]);
});

test("the uploads route marks the Uploads tab active and shows the panel", async () => {
  const view = renderSectionsPanel({ view: "uploads" });

  await waitFor(() => {
    expect(
      view
        .getByRole("tab", { name: EXPLORER_LABELS.uploadsAction })
        .getAttribute("aria-selected"),
    ).toBe("true");
  });
  expect(view.getByText(EXPLORER_LABELS.uploadsEmpty)).toBeTruthy();
});

test("tapping the Uploads tab navigates via its route opener", () => {
  const opened: string[] = [];
  const view = renderSectionsPanel(
    { view: "sync-lanes" },
    { openUploadsRoute: () => opened.push("uploads") },
  );

  fireEvent.click(
    view.getByRole("tab", { name: EXPLORER_LABELS.uploadsAction }),
  );
  expect(opened).toEqual(["uploads"]);
});

test("the embedded Sync Lanes panel drops the back-to-Explorer action", () => {
  const view = renderSectionsPanel({ view: "sync-lanes" });

  // The tab bar owns top-level navigation, so the list-mode back button is gone.
  expect(
    view.queryByRole("button", { name: EXPLORER_LABELS.syncLanesBackAction }),
  ).toBeNull();
});
