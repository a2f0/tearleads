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

  expect(
    formatExplorerRouteSegments({
      containerId: "container-1",
      view: "container-info",
    }),
  ).toEqual(["containers", "container-1", "info"]);
  expect(
    formatExplorerRouteSegments({ view: "selection" }, "document-1"),
  ).toEqual(["items", "document-1"]);
});
