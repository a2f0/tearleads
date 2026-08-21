import { expect, test } from "bun:test";
import type { ContainerNode } from "@symcrypt/client-sdk";
import { syncedContainerDocumentObjectSyncState } from "@symcrypt/client-sdk";
import type { ContainerSystemSlot } from "@symcrypt/validators/containerSystemSlot";
import { getVisibleExplorerNodes } from "./ExplorerProvider";
import { getExplorerVisibleSystemSlots } from "./ExplorerSystemContainers";

function containerNode(input: {
  id: string;
  name: string;
  parentId: string | null;
  systemSlot?: ContainerSystemSlot;
}): ContainerNode {
  return {
    id: input.id,
    kind: "container",
    name: input.name,
    organizationId: "org-1",
    parentId: input.parentId,
    syncState: syncedContainerDocumentObjectSyncState,
    systemSlot: input.systemSlot ?? null,
  };
}

test("built-in slots wait for user-facing system slots", () => {
  expect(
    getExplorerVisibleSystemSlots(
      [],
      ["sys_v1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
    ).size,
  ).toBe(0);
});

test("explorer can show built-in organization system containers by slot", () => {
  const contactsSystemSlot =
    "sys_v1_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const trashSystemSlot = "sys_v1_ccccccccccccccccccccccccccccccccccccccccccc";
  const rosterSystemSlot = "sys_v1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const orgMetadataSystemSlot =
    "sys_v1_eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";

  const visibleIds = getVisibleExplorerNodes(
    [
      containerNode({ id: "root-container", name: "/", parentId: null }),
      containerNode({
        id: "contacts-container",
        name: "Contacts",
        parentId: "root-container",
        systemSlot: contactsSystemSlot,
      }),
      containerNode({
        id: "trash-container",
        name: "Trash",
        parentId: "root-container",
        systemSlot: trashSystemSlot,
      }),
      containerNode({
        id: "roster-profile-container",
        name: "Roster Profiles",
        parentId: "root-container",
        systemSlot: rosterSystemSlot,
      }),
      containerNode({
        id: "organization-metadata-container",
        name: "Organization Metadata",
        parentId: "root-container",
        systemSlot: orgMetadataSystemSlot,
      }),
    ],
    new Set([
      contactsSystemSlot,
      trashSystemSlot,
      rosterSystemSlot,
      orgMetadataSystemSlot,
    ]),
  ).map((node) => node.id);

  expect(visibleIds).toEqual([
    "root-container",
    "contacts-container",
    "trash-container",
    "roster-profile-container",
    "organization-metadata-container",
  ]);
});
