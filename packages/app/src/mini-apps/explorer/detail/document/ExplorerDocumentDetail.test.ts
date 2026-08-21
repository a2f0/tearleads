import { expect, test } from "bun:test";
import type { ContainerNode } from "@symcrypt/client-sdk";
import { syncedContainerDocumentObjectSyncState } from "@symcrypt/client-sdk";
import { getLinkedContainerDetails } from "./ExplorerDocumentDetail";

const nodes = [
  {
    id: "root-container",
    kind: "container",
    name: "Root",
    organizationId: "org-1",
    parentId: null,
    syncState: syncedContainerDocumentObjectSyncState,
  },
  {
    icon: "playlist",
    id: "archive-container",
    kind: "container",
    name: "Archive",
    organizationId: "org-1",
    parentId: "root-container",
    syncState: syncedContainerDocumentObjectSyncState,
  },
] satisfies ReadonlyArray<ContainerNode>;

test("linked container details preserve order, names, and fallback labels", () => {
  expect(
    getLinkedContainerDetails(
      nodes,
      ["archive-container", "missing-container", "root-container"],
      "root-container",
    ),
  ).toEqual([
    {
      canWrite: true,
      icon: "playlist",
      id: "archive-container",
      isActive: false,
      label: "Archive",
    },
    {
      canWrite: false,
      icon: null,
      id: "missing-container",
      isActive: false,
      label: "missing-container",
    },
    {
      canWrite: true,
      icon: null,
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
          syncState: syncedContainerDocumentObjectSyncState,
        },
      ],
      ["root-container"],
      "root-container",
    ),
  ).toEqual([
    {
      canWrite: true,
      icon: null,
      id: "root-container",
      isActive: true,
      label: "Root",
    },
  ]);
});
