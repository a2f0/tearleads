import { expect, test } from "bun:test";
import {
  createContainerDocumentObjectSyncState,
  syncedContainerDocumentObjectSyncState,
} from "@tearleads/client-sdk";
import {
  canProvisionExplorerSystemContainers,
  getExplorerSystemContainerId,
  getExplorerTrashContainerId,
  getVisibleExplorerNodes,
} from "./ExplorerProvider";

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
  expect(getExplorerTrashContainerId(null, trashSystemSlot)).toBeNull();
  expect(getExplorerTrashContainerId(undefined, trashSystemSlot)).toBeNull();
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

test("explorer resolves the trash system container from system nodes", () => {
  const trashSystemSlot = "sys_v1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

  expect(
    getExplorerTrashContainerId(
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
    getExplorerTrashContainerId(
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
