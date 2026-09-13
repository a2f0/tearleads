import { expect, test } from "bun:test";
import { syncedContainerDocumentObjectSyncState } from "@tearleads/client-sdk";
import { resolveExplorerDeleteTrashTarget } from "./ExplorerSystemContainers";

// Org-aware delete-to-trash resolution: a document under a foreign shared root
// must target THAT org's Trash, not the viewer's own Trash.
const VIEWER_ORG = "viewer-org";
const OWNER_ORG = "owner-org";
const VIEWER_TRASH_SLOT = "sys_v1_viewer_trash";
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
    // A peer's Trash carries the owner's opaque per-owner HMAC slot.
    systemSlot: "sys_v1_owner_trash_hmac",
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

test("delete resolves a foreign org's Trash only by the viewer's verified slot", () => {
  // An org the viewer's identity created (a custom org viewed from the personal
  // one) carries the viewer-derived Trash slot; that is the only foreign Trash
  // that can be verified, and it wins regardless of its display name.
  const ownedForeignTree = viewerTreeNodes.map((node) =>
    node.id === "owner-trash"
      ? { ...node, name: "Bin", systemSlot: VIEWER_TRASH_SLOT }
      : node,
  );
  expect(
    resolveExplorerDeleteTrashTarget({
      containerId: "owner-folder",
      currentOrganizationId: VIEWER_ORG,
      nodes: ownedForeignTree,
      trashSystemSlot: VIEWER_TRASH_SLOT,
    }),
  ).toEqual({ canFallBackToOwnTrash: false, trashContainerId: "owner-trash" });
  // Another identity's Trash slot cannot be derived, so it is not selectable.
  expect(
    resolveExplorerDeleteTrashTarget({
      containerId: "owner-folder",
      currentOrganizationId: VIEWER_ORG,
      nodes: viewerTreeNodes,
      trashSystemSlot: VIEWER_TRASH_SLOT,
    }),
  ).toEqual({ canFallBackToOwnTrash: false, trashContainerId: null });
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
  ).toEqual({ canFallBackToOwnTrash: false, trashContainerId: null });
});

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
