import { expect, test } from "bun:test";
import { syncedContainerDocumentObjectSyncState } from "@symcrypt/client-sdk";
import {
  getExplorerSystemContainerId,
  getVisibleExplorerNodes,
} from "./ExplorerProvider";

test("explorer keeps same-slot user-facing system containers from separate organizations", () => {
  const trashSystemSlot = "sys_v1_ccccccccccccccccccccccccccccccccccccccccccc";

  expect(
    getVisibleExplorerNodes(
      [
        {
          id: "personal-root",
          kind: "container",
          name: "/",
          organizationId: "personal-org",
          parentId: null,
          syncState: syncedContainerDocumentObjectSyncState,
        },
        {
          id: "personal-trash",
          kind: "container",
          name: "Trash",
          organizationId: "personal-org",
          parentId: "personal-root",
          syncState: syncedContainerDocumentObjectSyncState,
          systemSlot: trashSystemSlot,
        },
        {
          id: "work-root",
          kind: "container",
          name: "/",
          organizationId: "work-org",
          parentId: null,
          syncState: syncedContainerDocumentObjectSyncState,
        },
        {
          id: "work-trash",
          kind: "container",
          name: "Trash",
          organizationId: "work-org",
          parentId: "work-root",
          syncState: syncedContainerDocumentObjectSyncState,
          systemSlot: trashSystemSlot,
        },
      ],
      new Set([trashSystemSlot]),
      "work-org",
    ).map((node) => node.id),
  ).toEqual(["personal-root", "personal-trash", "work-root", "work-trash"]);
});

test("explorer resolves same-slot trash by organization when requested", () => {
  const trashSystemSlot = "sys_v1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

  const nodes = [
    {
      id: "personal-trash",
      kind: "container" as const,
      name: "Trash",
      organizationId: "personal-org",
      parentId: "personal-root",
      syncState: syncedContainerDocumentObjectSyncState,
      systemSlot: trashSystemSlot,
    },
    {
      id: "work-trash",
      kind: "container" as const,
      name: "Trash",
      organizationId: "work-org",
      parentId: "work-root",
      syncState: syncedContainerDocumentObjectSyncState,
      systemSlot: trashSystemSlot,
    },
  ];

  expect(getExplorerSystemContainerId(nodes, trashSystemSlot, "work-org")).toBe(
    "work-trash",
  );
  expect(
    getExplorerSystemContainerId(nodes, trashSystemSlot, "personal-org"),
  ).toBe("personal-trash");
});

test("explorer resolves the active-root system container before an organization fallback", () => {
  const trashSystemSlot = "sys_v1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

  expect(
    getExplorerSystemContainerId(
      [
        {
          id: "stale-work-trash",
          kind: "container",
          name: "Trash",
          organizationId: "work-org",
          parentId: "stale-root",
          syncState: syncedContainerDocumentObjectSyncState,
          systemSlot: trashSystemSlot,
        },
        {
          id: "active-work-trash",
          kind: "container",
          name: "Trash",
          organizationId: "work-org",
          parentId: "active-root",
          syncState: syncedContainerDocumentObjectSyncState,
          systemSlot: trashSystemSlot,
        },
      ],
      trashSystemSlot,
      "work-org",
      "active-root",
    ),
  ).toBe("active-work-trash");
});
