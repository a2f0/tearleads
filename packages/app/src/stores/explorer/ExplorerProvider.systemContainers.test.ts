import { expect, test } from "bun:test";
import {
  createContainerDocumentObjectSyncState,
  syncedContainerDocumentObjectSyncState,
} from "@symcrypt/client-sdk";
import {
  canProvisionExplorerSystemContainers,
  getExplorerSystemContainerId,
  getVisibleExplorerNodes,
} from "./ExplorerProvider";
import { resolveExplorerDeleteTrashTarget } from "./ExplorerSystemContainers";

test("explorer only shows user-facing system containers", () => {
  const contactsSystemSlot =
    "sys_v1_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const trashSystemSlot = "sys_v1_ccccccccccccccccccccccccccccccccccccccccccc";
  const rosterSystemSlot = "sys_v1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

  expect(
    getVisibleExplorerNodes(
      [
        {
          id: "root-container",
          kind: "container",
          name: "/",
          organizationId: "org-1",
          parentId: null,
          syncState: syncedContainerDocumentObjectSyncState,
        },
        {
          id: "contacts-container",
          kind: "container",
          name: "Contacts",
          organizationId: "org-1",
          parentId: "root-container",
          syncState: syncedContainerDocumentObjectSyncState,
          systemSlot: contactsSystemSlot,
        },
        {
          id: "trash-container",
          kind: "container",
          name: "Trash",
          organizationId: "org-1",
          parentId: "root-container",
          syncState: syncedContainerDocumentObjectSyncState,
          systemSlot: trashSystemSlot,
        },
        {
          id: "spoofed-contacts-container",
          kind: "container",
          name: "Contacts",
          organizationId: "org-1",
          parentId: "root-container",
          syncState: syncedContainerDocumentObjectSyncState,
          systemSlot: "sys_v1_ddddddddddddddddddddddddddddddddddddddddddd",
        },
        {
          id: "roster-profile-container",
          kind: "container",
          name: "Roster Profiles",
          organizationId: "org-1",
          parentId: "root-container",
          syncState: syncedContainerDocumentObjectSyncState,
          systemSlot: rosterSystemSlot,
        },
      ],
      new Set([contactsSystemSlot, trashSystemSlot]),
    ).map((node) => node.id),
  ).toEqual(["root-container", "contacts-container", "trash-container"]);
});

test("explorer shows shared user-facing system containers by name", () => {
  const contactsSystemSlot =
    "sys_v1_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const trashSystemSlot = "sys_v1_ccccccccccccccccccccccccccccccccccccccccccc";

  expect(
    getVisibleExplorerNodes(
      [
        {
          id: "shared-root-container",
          kind: "container",
          name: "Shared Root",
          organizationId: "owner-org",
          parentId: null,
          syncState: syncedContainerDocumentObjectSyncState,
        },
        {
          id: "peer-contacts-container",
          kind: "container",
          name: "Contacts",
          organizationId: "owner-org",
          parentId: "shared-root-container",
          syncState: syncedContainerDocumentObjectSyncState,
          systemSlot: "owner-contacts-slot",
        },
        {
          id: "peer-trash-container",
          kind: "container",
          name: "Trash",
          organizationId: "owner-org",
          parentId: "shared-root-container",
          syncState: syncedContainerDocumentObjectSyncState,
          systemSlot: "owner-trash-slot",
        },
        {
          id: "peer-roster-profile-container",
          kind: "container",
          name: "Roster Profiles",
          organizationId: "owner-org",
          parentId: "shared-root-container",
          syncState: syncedContainerDocumentObjectSyncState,
          systemSlot: "owner-roster-slot",
        },
        {
          id: "same-org-trash-spoof",
          kind: "container",
          name: "Trash",
          organizationId: "viewer-org",
          parentId: "shared-root-container",
          syncState: syncedContainerDocumentObjectSyncState,
          systemSlot: "same-org-spoof-slot",
        },
      ],
      new Set([contactsSystemSlot, trashSystemSlot]),
      "viewer-org",
    ).map((node) => node.id),
  ).toEqual([
    "shared-root-container",
    "peer-contacts-container",
    "peer-trash-container",
  ]);
});

test("explorer keeps named user-facing system containers before visible slots resolve", () => {
  expect(
    getVisibleExplorerNodes([
      {
        id: "root-container",
        kind: "container",
        name: "/",
        organizationId: "org-1",
        parentId: null,
        syncState: syncedContainerDocumentObjectSyncState,
      },
      {
        id: "contacts-container",
        kind: "container",
        name: "Contacts",
        organizationId: "org-1",
        parentId: "root-container",
        syncState: syncedContainerDocumentObjectSyncState,
        systemSlot: "sys_v1_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      },
      {
        id: "trash-container",
        kind: "container",
        name: "Trash",
        organizationId: "org-1",
        parentId: "root-container",
        syncState: syncedContainerDocumentObjectSyncState,
        systemSlot: "sys_v1_ccccccccccccccccccccccccccccccccccccccccccc",
      },
      {
        id: "roster-profile-container",
        kind: "container",
        name: "Roster Profiles",
        organizationId: "org-1",
        parentId: "root-container",
        syncState: syncedContainerDocumentObjectSyncState,
        systemSlot: "sys_v1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      },
    ]).map((node) => node.id),
  ).toEqual(["root-container", "contacts-container", "trash-container"]);
});

test("explorer node helpers tolerate nullish node snapshots", () => {
  const trashSystemSlot = "sys_v1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

  expect(getVisibleExplorerNodes(null)).toEqual([]);
  expect(getVisibleExplorerNodes(undefined)).toEqual([]);
  expect(getExplorerSystemContainerId(null, trashSystemSlot)).toBeNull();
  expect(getExplorerSystemContainerId(undefined, trashSystemSlot)).toBeNull();
});

test("explorer system container provisioning tolerates nullish node snapshots", () => {
  expect(
    canProvisionExplorerSystemContainers({
      isAuthenticated: false,
      nodes: null,
      organizationId: null,
      rootContainerId: null,
    }),
  ).toBe(true);
  expect(
    canProvisionExplorerSystemContainers({
      isAuthenticated: true,
      nodes: null,
      organizationId: "org-1",
      rootContainerId: "root-container",
    }),
  ).toBe(false);
  expect(
    canProvisionExplorerSystemContainers({
      isAuthenticated: true,
      nodes: undefined,
      organizationId: "org-1",
      rootContainerId: "root-container",
    }),
  ).toBe(false);
});

test("explorer system container provisioning requires the authenticated root node", () => {
  expect(
    canProvisionExplorerSystemContainers({
      isAuthenticated: true,
      nodes: [
        {
          id: "root-container",
          kind: "container",
          name: "/",
          organizationId: "org-1",
          parentId: null,
          syncState: syncedContainerDocumentObjectSyncState,
        },
      ],
      organizationId: "org-1",
      rootContainerId: "root-container",
    }),
  ).toBe(true);
  expect(
    canProvisionExplorerSystemContainers({
      isAuthenticated: true,
      nodes: [
        {
          id: "shared-root-container",
          kind: "container",
          name: "/",
          organizationId: "org-2",
          parentId: null,
          syncState: syncedContainerDocumentObjectSyncState,
        },
      ],
      organizationId: "org-1",
      rootContainerId: "root-container",
    }),
  ).toBe(false);
});

test("explorer system container provisioning accepts the active root before org metadata converges", () => {
  expect(
    canProvisionExplorerSystemContainers({
      isAuthenticated: true,
      nodes: [
        {
          id: "root-container",
          kind: "container",
          name: "/",
          organizationId: "local-org",
          parentId: null,
          syncState: createContainerDocumentObjectSyncState({
            localOnly: true,
          }),
        },
      ],
      organizationId: "org-1",
      rootContainerId: "root-container",
    }),
  ).toBe(true);
});

test("explorer resolves system containers by slot", () => {
  const contactsSystemSlot =
    "sys_v1_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const trashSystemSlot = "sys_v1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

  expect(
    getExplorerSystemContainerId(
      [
        {
          id: "contacts-container",
          kind: "container",
          name: "Contacts",
          organizationId: "org-1",
          parentId: "root-container",
          syncState: syncedContainerDocumentObjectSyncState,
          systemSlot: contactsSystemSlot,
        },
        {
          id: "trash-container",
          kind: "container",
          name: "Trash",
          organizationId: "org-1",
          parentId: "root-container",
          syncState: syncedContainerDocumentObjectSyncState,
          systemSlot: trashSystemSlot,
        },
      ],
      contactsSystemSlot,
    ),
  ).toBe("contacts-container");
});

test("explorer resolves system containers under the active root before org metadata converges", () => {
  const contactsSystemSlot =
    "sys_v1_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

  expect(
    getExplorerSystemContainerId(
      [
        {
          id: "personal-contacts",
          kind: "container",
          name: "Contacts",
          organizationId: "personal-org",
          parentId: "personal-root",
          syncState: syncedContainerDocumentObjectSyncState,
          systemSlot: contactsSystemSlot,
        },
        {
          id: "work-contacts",
          kind: "container",
          name: "Contacts",
          organizationId: "local-org",
          parentId: "work-root",
          syncState: createContainerDocumentObjectSyncState({
            localOnly: true,
          }),
          systemSlot: contactsSystemSlot,
        },
      ],
      contactsSystemSlot,
      "work-org",
      "work-root",
    ),
  ).toBe("work-contacts");
});

test("explorer resolves the trash system container from system nodes", () => {
  const trashSystemSlot = "sys_v1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

  expect(
    getExplorerSystemContainerId(
      [
        {
          id: "root-container",
          kind: "container",
          name: "/",
          organizationId: "org-1",
          parentId: null,
          syncState: syncedContainerDocumentObjectSyncState,
        },
        {
          id: "trash-container",
          kind: "container",
          name: "Trash",
          organizationId: "org-1",
          parentId: "root-container",
          syncState: syncedContainerDocumentObjectSyncState,
          systemSlot: trashSystemSlot,
        },
      ],
      trashSystemSlot,
    ),
  ).toBe("trash-container");
});

test("explorer resolves local-only trash containers", () => {
  const trashSystemSlot = "sys_v1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

  expect(
    getExplorerSystemContainerId(
      [
        {
          id: "trash-container",
          kind: "container",
          name: "Trash",
          organizationId: "org-1",
          parentId: "root-container",
          syncState: createContainerDocumentObjectSyncState({
            localOnly: true,
          }),
          systemSlot: trashSystemSlot,
        },
      ],
      trashSystemSlot,
    ),
  ).toBe("trash-container");
});

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

test("delete resolves the foreign org's Trash for a shared-root container", () => {
  expect(
    resolveExplorerDeleteTrashTarget({
      containerId: "owner-folder",
      currentOrganizationId: VIEWER_ORG,
      nodes: viewerTreeNodes,
      trashSystemSlot: VIEWER_TRASH_SLOT,
    }),
  ).toEqual({ canFallBackToOwnTrash: false, trashContainerId: "owner-trash" });
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
