import { expect, test } from "bun:test";
import type { ContainerNode } from "@symcrypt/client-sdk";
import { syncedContainerDocumentObjectSyncState } from "@symcrypt/client-sdk";
import { EXPLORER_LABELS } from "../labels";
import {
  buildExplorerSidebarSections,
  type ExplorerSidebarDocumentWindowState,
  getExplorerSidebarRowsInRange,
} from "./ExplorerSidebarRows";
import { buildExplorerTree } from "./explorerTreeModel";

function loadedEmptyWindow(): ExplorerSidebarDocumentWindowState {
  return {
    error: null,
    isLoading: false,
    offset: 0,
    rows: [],
    totalCount: 0,
  };
}

function rootContainer(input: {
  id: string;
  name: string;
  organizationId: string;
  parentId?: string | null;
}): ContainerNode {
  return {
    id: input.id,
    kind: "container",
    name: input.name,
    organizationId: input.organizationId,
    parentId: input.parentId ?? null,
    syncState: syncedContainerDocumentObjectSyncState,
  };
}

// Renders the sidebar to the ordered list of container names / section labels
// so tests can assert grouping and heading order directly.
function renderSidebarLabels(input: {
  nodes: ContainerNode[];
  organizationNamesById?: ReadonlyMap<string, string>;
  primaryOrganizationId: string | null;
}): Array<string | null> {
  const sections = buildExplorerSidebarSections({
    collapsedIds: new Set(),
    documentWindowsByContainerId: new Map(
      input.nodes.map((node) => [node.id, loadedEmptyWindow()]),
    ),
    entries: buildExplorerTree(input.nodes),
    organizationNamesById: input.organizationNamesById ?? new Map(),
    primaryOrganizationId: input.primaryOrganizationId,
  });
  const rows = getExplorerSidebarRowsInRange({
    collapsedIds: new Set(),
    limit: 20,
    offset: 0,
    sections,
  });
  return rows.map((row) => {
    if (row.kind === "container") {
      return row.entry.node.name;
    }
    if (row.kind === "section-label") {
      return row.label;
    }
    return null;
  });
}

test("explorer sidebar groups containers shared from another organization", () => {
  const nodes = [
    rootContainer({
      id: "local-container",
      name: "Zulu",
      organizationId: "org-1",
    }),
    rootContainer({
      id: "shared-container",
      name: "Alpha",
      organizationId: "org-2",
    }),
    rootContainer({
      id: "shared-child-container",
      name: "Beta",
      organizationId: "org-2",
      parentId: "shared-container",
    }),
  ];

  expect(
    renderSidebarLabels({ nodes, primaryOrganizationId: "org-1" }),
  ).toEqual(["Zulu", EXPLORER_LABELS.sharedWithMeSection, "Alpha", "Beta"]);
});

test("explorer sidebar heads a foreign organization with its decrypted name", () => {
  const nodes = [
    rootContainer({
      id: "local-container",
      name: "Zulu",
      organizationId: "org-1",
    }),
    rootContainer({
      id: "shared-container",
      name: "Alpha",
      organizationId: "org-2",
    }),
    rootContainer({
      id: "shared-child-container",
      name: "Beta",
      organizationId: "org-2",
      parentId: "shared-container",
    }),
  ];

  expect(
    renderSidebarLabels({
      nodes,
      organizationNamesById: new Map([["org-2", "Acme Corp"]]),
      primaryOrganizationId: "org-1",
    }),
  ).toEqual(["Zulu", "Acme Corp", "Alpha", "Beta"]);
});

test("explorer sidebar heads each named foreign organization, sorted by name", () => {
  const nodes = [
    rootContainer({
      id: "local-container",
      name: "Home",
      organizationId: "org-1",
    }),
    rootContainer({
      id: "widgets-root",
      name: "Widgets",
      organizationId: "org-widgets",
    }),
    rootContainer({
      id: "acme-root",
      name: "Files",
      organizationId: "org-acme",
    }),
  ];

  expect(
    renderSidebarLabels({
      nodes,
      organizationNamesById: new Map([
        ["org-widgets", "Widgets Inc"],
        ["org-acme", "Acme Corp"],
      ]),
      primaryOrganizationId: "org-1",
    }),
  ).toEqual(["Home", "Acme Corp", "Files", "Widgets Inc", "Widgets"]);
});

test("explorer sidebar keeps unnamed foreign organizations under the shared heading", () => {
  const nodes = [
    rootContainer({
      id: "local-container",
      name: "Home",
      organizationId: "org-1",
    }),
    rootContainer({
      id: "acme-root",
      name: "Files",
      organizationId: "org-acme",
    }),
    rootContainer({
      id: "pending-root",
      name: "Docs",
      organizationId: "org-pending",
    }),
  ];

  // org-acme has decrypted; org-pending has not, so it falls back to the shared
  // heading appended after the named sections.
  expect(
    renderSidebarLabels({
      nodes,
      organizationNamesById: new Map([["org-acme", "Acme Corp"]]),
      primaryOrganizationId: "org-1",
    }),
  ).toEqual([
    "Home",
    "Acme Corp",
    "Files",
    EXPLORER_LABELS.sharedWithMeSection,
    "Docs",
  ]);
});

test("explorer sidebar keeps the personal organization primary when another organization is active", () => {
  const nodes = [
    rootContainer({
      id: "personal-root",
      name: "Personal",
      organizationId: "org-personal",
    }),
    rootContainer({
      id: "work-root",
      name: "Work",
      organizationId: "org-work",
    }),
  ];

  expect(
    renderSidebarLabels({ nodes, primaryOrganizationId: "org-personal" }),
  ).toEqual(["Personal", EXPLORER_LABELS.sharedWithMeSection, "Work"]);
});

test("explorer sidebar does not show shared section for bootstrap nodes without organization ids", () => {
  const nodes = [
    rootContainer({
      id: "bootstrap-container",
      name: "Loading Root",
      organizationId: "",
    }),
  ];

  expect(
    renderSidebarLabels({ nodes, primaryOrganizationId: "org-1" }),
  ).toEqual(["Loading Root"]);
});
