import { afterEach, expect, test } from "bun:test";
import type { BlobStore } from "@tearleads/client-sdk";
import { createDomainScope } from "@tearleads/client-sdk";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { EXPLORER_LABELS } from "../labels";
import type { ExplorerRoute } from "../routes";
import {
  ExplorerCompactTabs,
  isExplorerCompactHubRoute,
} from "./ExplorerCompactTabs";

afterEach(cleanup);

function createBlobStore(): BlobStore {
  return {
    deleteBytes: async () => undefined,
    readBytes: async () => null,
    writeBytes: async () => undefined,
  };
}

function renderCompactTabs(
  route: ExplorerRoute,
  overrides: {
    onOpenSyncLaneDetailRoute?: (laneKey: string) => void;
    openBlobBrowserRoute?: () => void;
    openSyncLanesRoute?: () => void;
  } = {},
) {
  return render(
    <ExplorerCompactTabs
      blobPickTarget={null}
      blobStore={createBlobStore()}
      domainScope={createDomainScope()}
      loadBlobInfo={async () => ({ rows: [], totalCount: 0 })}
      nodes={[]}
      onCancelBlobPick={() => undefined}
      onOpenSyncLaneDetailRoute={
        overrides.onOpenSyncLaneDetailRoute ?? (() => undefined)
      }
      onPickBlob={() => undefined}
      online={true}
      openBlobBrowserRoute={overrides.openBlobBrowserRoute ?? (() => undefined)}
      openDocumentInfoRoute={() => undefined}
      openSyncLanesRoute={overrides.openSyncLanesRoute ?? (() => undefined)}
      route={route}
      selectDocumentProjection={() => undefined}
    />,
  );
}

test("isExplorerCompactHubRoute covers only the tab-hub routes", () => {
  expect(isExplorerCompactHubRoute("selection")).toBe(true);
  expect(isExplorerCompactHubRoute("sync-lanes")).toBe(true);
  expect(isExplorerCompactHubRoute("sync-lane-detail")).toBe(true);
  expect(isExplorerCompactHubRoute("blob-browser")).toBe(true);
  expect(isExplorerCompactHubRoute("document-info")).toBe(false);
  expect(isExplorerCompactHubRoute("container-info")).toBe(false);
  expect(isExplorerCompactHubRoute("document-selection")).toBe(false);
  expect(isExplorerCompactHubRoute("new-structured-document")).toBe(false);
});

test("the default (selection) route shows both tabs with Sync Lanes active", () => {
  const view = renderCompactTabs({ view: "selection" });

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
});

test("the blob-browser route marks the Blob Browser tab active", async () => {
  const view = renderCompactTabs({
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
  const view = renderCompactTabs(
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
  const view = renderCompactTabs(
    { view: "sync-lanes" },
    { openBlobBrowserRoute: () => opened.push("blobs") },
  );

  fireEvent.keyDown(
    view.getByRole("tab", { name: EXPLORER_LABELS.syncLanesAction }),
    { key: "ArrowRight" },
  );
  expect(opened).toEqual(["blobs"]);
});

test("the embedded Sync Lanes panel drops the back-to-Explorer action", () => {
  const view = renderCompactTabs({ view: "sync-lanes" });

  // The tab bar owns top-level navigation, so the list-mode back button is gone.
  expect(
    view.queryByRole("button", { name: EXPLORER_LABELS.syncLanesBackAction }),
  ).toBeNull();
});

test("the embedded Blob Browser panel drops the back-to-Explorer action", async () => {
  const view = renderCompactTabs({
    blobId: null,
    storageKey: null,
    view: "blob-browser",
  });

  await waitFor(() => {
    expect(
      view.getByRole("tab", { name: EXPLORER_LABELS.blobBrowserAction }),
    ).toBeTruthy();
  });
  expect(
    view.queryByRole("button", { name: EXPLORER_LABELS.blobBrowserBackAction }),
  ).toBeNull();
});
