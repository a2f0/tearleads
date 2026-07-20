import { expect, test } from "bun:test";
import type { ContainerNode } from "@tearleads/client-sdk";
import { syncedContainerDocumentObjectSyncState } from "@tearleads/client-sdk";
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
