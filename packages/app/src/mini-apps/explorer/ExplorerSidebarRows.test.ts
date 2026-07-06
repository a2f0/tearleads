import { expect, test } from "bun:test";
import type { ContainerNode } from "@tearleads/client-sdk";
import { syncedContainerDocumentObjectSyncState } from "@tearleads/client-sdk";
import {
  buildExplorerSidebarSections,
  type ExplorerSidebarDocumentWindowState,
  getExplorerSidebarRowsInRange,
} from "./ExplorerSidebarRows";
import { buildExplorerTree } from "./explorerTreeModel";
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
    documentWindowsByContainerId: new Map(
      nodes.map((node) => [node.id, loadedEmptyWindow()]),
    ),
    entries: buildExplorerTree(nodes),
    primaryOrganizationId: "org-1",
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

test("explorer sidebar keeps the personal organization primary when another organization is active", () => {
  const nodes: ContainerNode[] = [
    {
      id: "personal-root",
      kind: "container",
      name: "Personal",
      organizationId: "org-personal",
      parentId: null,
      syncState: syncedContainerDocumentObjectSyncState,
    },
    {
      id: "work-root",
      kind: "container",
      name: "Work",
      organizationId: "org-work",
      parentId: null,
      syncState: syncedContainerDocumentObjectSyncState,
    },
  ];
  const sections = buildExplorerSidebarSections({
    collapsedIds: new Set(),
    documentWindowsByContainerId: new Map(
      nodes.map((node) => [node.id, loadedEmptyWindow()]),
    ),
    entries: buildExplorerTree(nodes),
    primaryOrganizationId: "org-personal",
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
  ).toEqual(["Personal", EXPLORER_LABELS.sharedWithMeSection, "Work"]);
});

test("explorer sidebar does not show shared section for bootstrap nodes without organization ids", () => {
  const nodes: ContainerNode[] = [
    {
      id: "bootstrap-container",
      kind: "container",
      name: "Loading Root",
      organizationId: "",
      parentId: null,
      syncState: syncedContainerDocumentObjectSyncState,
    },
  ];
  const sections = buildExplorerSidebarSections({
    collapsedIds: new Set(),
    documentWindowsByContainerId: new Map(
      nodes.map((node) => [node.id, loadedEmptyWindow()]),
    ),
    entries: buildExplorerTree(nodes),
    primaryOrganizationId: "org-1",
  });
  const rows = getExplorerSidebarRowsInRange({
    collapsedIds: new Set(),
    limit: 10,
    offset: 0,
    sections,
  });

  expect(rows.map((row) => row.kind)).toEqual(["container"]);
  const firstRow = rows[0];
  expect(firstRow?.kind === "container" ? firstRow.entry.node.name : null).toBe(
    "Loading Root",
  );
});
