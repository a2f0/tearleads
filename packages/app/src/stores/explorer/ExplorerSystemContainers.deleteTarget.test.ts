import { expect, test } from "bun:test";
import { syncedContainerDocumentObjectSyncState } from "@tearleads/client-sdk";
import { deriveOrganizationTrashSystemSlot } from "@tearleads/validators/containerSystemSlot";
import { resolveExplorerDeleteTrashTarget } from "./ExplorerSystemContainers";

// Org-aware delete-to-trash resolution: a document under a foreign shared root
// must target THAT org's Trash, not the viewer's own Trash.
const VIEWER_ORG = "viewer-org";
const OWNER_ORG = "owner-org";
const VIEWER_TRASH_SLOT = deriveOrganizationTrashSystemSlot(VIEWER_ORG);
const viewerTreeNodes = [
  {
    id: "viewer-root",
    kind: "container" as const,
    name: "/",
    organizationId: VIEWER_ORG,
    parentId: null,
    syncState: syncedContainerDocumentObjectSyncState,
  },
  {
    id: "viewer-trash",
    kind: "container" as const,
    name: "Trash",
    organizationId: VIEWER_ORG,
    parentId: "viewer-root",
    syncState: syncedContainerDocumentObjectSyncState,
    systemSlot: VIEWER_TRASH_SLOT,
  },
  {
    id: "viewer-folder",
    kind: "container" as const,
    name: "Notes",
    organizationId: VIEWER_ORG,
    parentId: "viewer-root",
    syncState: syncedContainerDocumentObjectSyncState,
  },
  {
    id: "owner-root",
    kind: "container" as const,
    name: "/",
    organizationId: OWNER_ORG,
    parentId: null,
    syncState: syncedContainerDocumentObjectSyncState,
  },
  {
    id: "owner-trash",
    kind: "container" as const,
    name: "Trash",
    organizationId: OWNER_ORG,
    parentId: "owner-root",
    syncState: syncedContainerDocumentObjectSyncState,
    systemSlot: deriveOrganizationTrashSystemSlot(OWNER_ORG),
  },
  {
    id: "owner-folder",
    kind: "container" as const,
    name: "Shared",
    organizationId: OWNER_ORG,
    parentId: "owner-root",
    syncState: syncedContainerDocumentObjectSyncState,
  },
];

test("delete resolves the viewer's own Trash for an own-org container", () => {
  expect(
    resolveExplorerDeleteTrashTarget({
      containerId: "viewer-folder",
      currentOrganizationId: VIEWER_ORG,
      nodes: viewerTreeNodes,
      trashSystemSlot: VIEWER_TRASH_SLOT,
    }),
  ).toEqual({ canFallBackToOwnTrash: true, trashContainerId: "viewer-trash" });
});

test("delete resolves the shared organization’s Trash after a display-name change", () => {
  const nodes = viewerTreeNodes.map((node) =>
    node.id === "owner-trash" ? { ...node, name: "Bin" } : node,
  );
  expect(
    resolveExplorerDeleteTrashTarget({
      containerId: "owner-folder",
      currentOrganizationId: VIEWER_ORG,
      nodes,
      trashSystemSlot: VIEWER_TRASH_SLOT,
    }),
  ).toEqual({ canFallBackToOwnTrash: false, trashContainerId: "owner-trash" });
});

test("delete never selects a foreign system child by its 'Trash' name", () => {
  // A renamed Contacts (any metadata writer can rename) listed before the real
  // Trash must not become the delete destination.
  const renamedContacts = {
    id: "owner-contacts",
    kind: "container" as const,
    name: "Trash",
    organizationId: OWNER_ORG,
    parentId: "owner-root",
    syncState: syncedContainerDocumentObjectSyncState,
    systemSlot: "sys_v1_owner_contacts_hmac",
  };
  const ownerTrashIndex = viewerTreeNodes.findIndex(
    (node) => node.id === "owner-trash",
  );
  const nodes = [
    ...viewerTreeNodes.slice(0, ownerTrashIndex),
    renamedContacts,
    ...viewerTreeNodes.slice(ownerTrashIndex),
  ];
  expect(
    resolveExplorerDeleteTrashTarget({
      containerId: "owner-folder",
      currentOrganizationId: VIEWER_ORG,
      nodes,
      trashSystemSlot: VIEWER_TRASH_SLOT,
    }),
  ).toEqual({ canFallBackToOwnTrash: false, trashContainerId: "owner-trash" });
});

test.each([
  { systemSlot: VIEWER_TRASH_SLOT },
  { parentId: "owner-folder" },
  { organizationId: VIEWER_ORG },
])(
  "shared Trash requires the signed slot, data root, and organization to agree",
  (change) => {
    const nodes = viewerTreeNodes.map((node) =>
      node.id === "owner-trash" ? { ...node, ...change } : node,
    );
    expect(
      resolveExplorerDeleteTrashTarget({
        containerId: "owner-folder",
        currentOrganizationId: VIEWER_ORG,
        nodes,
        trashSystemSlot: VIEWER_TRASH_SLOT,
      }),
    ).toEqual({ canFallBackToOwnTrash: false, trashContainerId: null });
  },
);

test("delete never falls back to the viewer's Trash when a foreign Trash is absent", () => {
  const withoutOwnerTrash = viewerTreeNodes.filter(
    (node) => node.id !== "owner-trash",
  );
  expect(
    resolveExplorerDeleteTrashTarget({
      containerId: "owner-folder",
      currentOrganizationId: VIEWER_ORG,
      nodes: withoutOwnerTrash,
      trashSystemSlot: VIEWER_TRASH_SLOT,
    }),
  ).toEqual({ canFallBackToOwnTrash: false, trashContainerId: null });
});

test("delete skips an earlier metadata root when resolving another owned org's Trash", () => {
  const metadataRoot = {
    id: "owner-metadata",
    kind: "container" as const,
    name: "Organization Metadata",
    organizationId: OWNER_ORG,
    parentId: null,
    syncState: syncedContainerDocumentObjectSyncState,
    systemSlot: "sys_v1_owner_metadata",
  };
  const nodes = [metadataRoot, ...viewerTreeNodes];
  expect(
    resolveExplorerDeleteTrashTarget({
      containerId: "owner-folder",
      currentOrganizationId: VIEWER_ORG,
      nodes,
      trashSystemSlot: VIEWER_TRASH_SLOT,
    }),
  ).toEqual({ canFallBackToOwnTrash: false, trashContainerId: "owner-trash" });
  expect(
    resolveExplorerDeleteTrashTarget({
      containerId: "owner-folder",
      currentOrganizationId: VIEWER_ORG,
      nodes: nodes.filter((node) => node.id !== "owner-root"),
      trashSystemSlot: VIEWER_TRASH_SLOT,
    }),
  ).toEqual({ canFallBackToOwnTrash: false, trashContainerId: null });
});
