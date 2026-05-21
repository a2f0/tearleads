import { expect, test } from "bun:test";
import { syncedExplorerObjectSyncState } from "@tearleads/client-sdk/workflows/explorer";
import type { ContainerNode } from "../../../stores/explorer/types";
import { getLinkedContainerDetails } from "./ExplorerDocumentDetail";

const nodes = [
  {
    id: "root-container",
    kind: "container",
    name: "Root",
    organizationId: "org-1",
    parentId: null,
    syncState: syncedExplorerObjectSyncState,
  },
  {
    id: "archive-container",
    kind: "container",
    name: "Archive",
    organizationId: "org-1",
    parentId: "root-container",
    syncState: syncedExplorerObjectSyncState,
  },
] satisfies ReadonlyArray<ContainerNode>;

test("linked container details preserve order, names, fallback labels, and active state", () => {
  expect(
    getLinkedContainerDetails(
      nodes,
      ["archive-container", "missing-container", "root-container"],
      "root-container",
    ),
  ).toEqual([
    {
      id: "archive-container",
      isActive: false,
      label: "Archive",
    },
    {
      id: "missing-container",
      isActive: false,
      label: "missing-container",
    },
    {
      id: "root-container",
      isActive: true,
      label: "Root",
    },
  ]);
});

test("linked container details preserve first matching node names", () => {
  expect(
    getLinkedContainerDetails(
      [
        ...nodes,
        {
          id: "root-container",
          kind: "container",
          name: "Duplicate Root",
          organizationId: "org-1",
          parentId: null,
          syncState: syncedExplorerObjectSyncState,
        },
      ],
      ["root-container"],
      null,
    ),
  ).toEqual([
    {
      id: "root-container",
      isActive: false,
      label: "Root",
    },
  ]);
});
