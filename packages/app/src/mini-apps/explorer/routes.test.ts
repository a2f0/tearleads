import { expect, test } from "bun:test";
import type { ContainerNode } from "@symcrypt/client-sdk";
import { syncedContainerDocumentObjectSyncState } from "@symcrypt/client-sdk";
import {
  createExplorerOrphanedDocumentsNode,
  EXPLORER_ORPHANED_DOCUMENTS_ID,
} from "../../stores/explorer/orphanedDocuments";
import {
  formatExplorerRouteSegments,
  isExplorerRouteAvailable,
  parseExplorerRouteSegments,
} from "./routes";

const nodes = [
  {
    id: "container-1",
    kind: "container",
    name: "Container",
    organizationId: "org-1",
    parentId: null,
    syncState: syncedContainerDocumentObjectSyncState,
  },
] satisfies ReadonlyArray<ContainerNode>;

test("explorer document-info route is available when its container exists", () => {
  expect(
    isExplorerRouteAvailable(
      {
        containerId: "container-1",
        localId: "local-document-1",
        view: "document-info",
      },
      nodes,
    ),
  ).toBe(true);
});

test("explorer document-info route is unavailable when its container is gone", () => {
  expect(
    isExplorerRouteAvailable(
      {
        containerId: "missing-container",
        localId: "local-document-1",
        view: "document-info",
      },
      nodes,
    ),
  ).toBe(false);
});

test("recovery document route remains available while its virtual node loads", () => {
  expect(
    isExplorerRouteAvailable(
      {
        containerId: EXPLORER_ORPHANED_DOCUMENTS_ID,
        localId: "local-document-1",
        view: "document-selection",
      },
      [],
    ),
  ).toBe(true);
});

test("recovery collection never exposes container-info", () => {
  expect(
    isExplorerRouteAvailable(
      {
        containerId: EXPLORER_ORPHANED_DOCUMENTS_ID,
        view: "container-info",
      },
      [createExplorerOrphanedDocumentsNode("org-1", "Orphaned Documents")],
    ),
  ).toBe(false);
});

test("explorer blob-browser route does not require a selected container", () => {
  expect(
    isExplorerRouteAvailable(
      {
        blobId: "blob-1",
        storageKey: null,
        view: "blob-browser",
      },
      [],
    ),
  ).toBe(true);
});

test("explorer sync-lanes route does not require a selected container", () => {
  expect(
    isExplorerRouteAvailable(
      {
        view: "sync-lanes",
      },
      [],
    ),
  ).toBe(true);
});

test("explorer sync-lane detail route does not require a selected container", () => {
  expect(
    isExplorerRouteAvailable(
      {
        laneKey: "documents:local-1",
        view: "sync-lane-detail",
      },
      [],
    ),
  ).toBe(true);
});

test("explorer uploads route does not require a selected container", () => {
  expect(isExplorerRouteAvailable({ view: "uploads" }, [])).toBe(true);
});

test("explorer write-queue route does not require a selected container", () => {
  expect(isExplorerRouteAvailable({ view: "write-queue" }, [])).toBe(true);
  expect(
    isExplorerRouteAvailable(
      { entryKey: "document::document-1", view: "write-queue-entry" },
      [],
    ),
  ).toBe(true);
});

test("explorer write-queue entry route round-trips its entry key", () => {
  expect(
    parseExplorerRouteSegments(["writes", "document::document-1"]),
  ).toEqual({
    route: { entryKey: "document::document-1", view: "write-queue-entry" },
  });
  expect(
    formatExplorerRouteSegments({
      entryKey: "document::document-1",
      view: "write-queue-entry",
    }),
  ).toEqual(["writes", "document::document-1"]);
});

test("explorer route segments cover selection and detail routes", () => {
  expect(parseExplorerRouteSegments(["items", "container-1"])).toEqual({
    route: { view: "selection" },
    selectedId: "container-1",
  });
  expect(
    parseExplorerRouteSegments([
      "containers",
      "container-1",
      "documents",
      "document-1",
    ]),
  ).toEqual({
    route: {
      containerId: "container-1",
      localId: "document-1",
      view: "document-selection",
    },
    selectedId: "document-1",
  });
  expect(
    parseExplorerRouteSegments([
      "containers",
      "container-1",
      "documents",
      "document-1",
      "info",
    ]),
  ).toEqual({
    route: {
      containerId: "container-1",
      localId: "document-1",
      view: "document-info",
    },
  });
  expect(
    parseExplorerRouteSegments(["blobs", "storage", "store-1", "blob", "b1"]),
  ).toEqual({
    route: {
      blobId: "b1",
      storageKey: "store-1",
      view: "blob-browser",
    },
  });
  expect(parseExplorerRouteSegments(["sync"])).toEqual({
    route: {
      view: "sync-lanes",
    },
  });
  expect(parseExplorerRouteSegments(["uploads"])).toEqual({
    route: { view: "uploads" },
  });
  expect(parseExplorerRouteSegments(["writes"])).toEqual({
    route: { view: "write-queue" },
  });
  expect(
    parseExplorerRouteSegments(["sync", "lanes", "documents:local-1"]),
  ).toEqual({
    route: {
      laneKey: "documents:local-1",
      view: "sync-lane-detail",
    },
  });

  expect(
    formatExplorerRouteSegments({
      containerId: "container-1",
      view: "container-info",
    }),
  ).toEqual(["containers", "container-1", "info"]);
  expect(
    formatExplorerRouteSegments({
      containerId: "container-1",
      localId: "document-1",
      view: "document-selection",
    }),
  ).toEqual(["containers", "container-1", "documents", "document-1"]);
  expect(
    formatExplorerRouteSegments({ view: "selection" }, "document-1"),
  ).toEqual(["items", "document-1"]);
  expect(formatExplorerRouteSegments({ view: "sync-lanes" })).toEqual(["sync"]);
  expect(formatExplorerRouteSegments({ view: "uploads" })).toEqual(["uploads"]);
  expect(formatExplorerRouteSegments({ view: "write-queue" })).toEqual([
    "writes",
  ]);
  expect(
    formatExplorerRouteSegments({
      laneKey: "documents:local-1",
      view: "sync-lane-detail",
    }),
  ).toEqual(["sync", "lanes", "documents:local-1"]);
});
