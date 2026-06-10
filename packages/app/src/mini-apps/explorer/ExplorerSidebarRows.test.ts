import { expect, test } from "bun:test";
import type { ContainerNode } from "@tearleads/client-sdk";
import { syncedContainerDocumentObjectSyncState } from "@tearleads/client-sdk";
import {
  buildExplorerSidebarSections,
  type ExplorerSidebarDocumentWindowState,
  getExplorerSidebarRowsInRange,
} from "./ExplorerSidebarRows";
import { buildExplorerTree } from "./ExplorerTree";
import { EXPLORER_LABELS } from "./labels";

function loadedEmptyWindow(): ExplorerSidebarDocumentWindowState {
  return {
    error: null,
    isLoading: false,
    offset: 0,
    rows: [],
    totalCount: 0,
  };
}

test("explorer sidebar groups containers shared from another organization", () => {
  const nodes: ContainerNode[] = [
    {
      id: "local-container",
      kind: "container",
      name: "Zulu",
      organizationId: "org-1",
      parentId: null,
      syncState: syncedContainerDocumentObjectSyncState,
    },
    {
      id: "shared-container",
      kind: "container",
      name: "Alpha",
      organizationId: "org-2",
      parentId: null,
      syncState: syncedContainerDocumentObjectSyncState,
    },
    {
      id: "shared-child-container",
      kind: "container",
      name: "Beta",
      organizationId: "org-2",
      parentId: "shared-container",
      syncState: syncedContainerDocumentObjectSyncState,
    },
  ];
  const sections = buildExplorerSidebarSections({
    collapsedIds: new Set(),
    currentOrganizationId: "org-1",
    documentWindowsByContainerId: new Map(
      nodes.map((node) => [node.id, loadedEmptyWindow()]),
    ),
    entries: buildExplorerTree(nodes),
  });
  const rows = getExplorerSidebarRowsInRange({
    collapsedIds: new Set(),
    limit: 10,
    offset: 0,
    sections,
  });

  expect(
    rows.map((row) =>
      row.kind === "container"
        ? row.entry.node.name
        : EXPLORER_LABELS.sharedWithMeSection,
    ),
  ).toEqual(["Zulu", EXPLORER_LABELS.sharedWithMeSection, "Alpha", "Beta"]);
});
