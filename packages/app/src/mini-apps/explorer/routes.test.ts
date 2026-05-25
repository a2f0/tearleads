import { expect, test } from "bun:test";
import type { ContainerNode } from "@tearleads/client-sdk";
import { syncedContainerDocumentObjectSyncState } from "@tearleads/client-sdk";
import { isExplorerRouteAvailable } from "./routes";

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
