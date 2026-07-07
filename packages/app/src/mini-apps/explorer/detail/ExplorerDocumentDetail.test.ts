import { expect, test } from "bun:test";
import type { ContainerNode } from "@tearleads/client-sdk";
import { syncedContainerDocumentObjectSyncState } from "@tearleads/client-sdk";
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
    getLinkedContainerDetails(nodes, [
      "archive-container",
      "missing-container",
      "root-container",
    ]),
  ).toEqual([
    {
      canWrite: true,
      id: "archive-container",
      label: "Archive",
    },
    {
      canWrite: false,
      id: "missing-container",
      label: "missing-container",
    },
    {
      canWrite: true,
      id: "root-container",
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
    ),
  ).toEqual([
    {
      canWrite: true,
      id: "root-container",
      label: "Root",
    },
  ]);
});
