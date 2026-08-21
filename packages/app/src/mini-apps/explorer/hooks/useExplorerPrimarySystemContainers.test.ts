import { expect, test } from "bun:test";
import type { ContainerNode } from "@symcrypt/client-sdk";
import { syncedContainerDocumentObjectSyncState } from "@symcrypt/client-sdk";
import { resolveExplorerPrimarySystemContainerIds } from "./useExplorerPrimarySystemContainers";

const CONTACTS_SLOT = "sys_v1_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const TRASH_SLOT = "sys_v1_ccccccccccccccccccccccccccccccccccccccccccc";

function node(input: {
  id: string;
  organizationId: string;
  parentId: string | null;
  systemSlot?: typeof CONTACTS_SLOT | typeof TRASH_SLOT;
}): ContainerNode {
  return {
    id: input.id,
    kind: "container",
    name: input.id,
    organizationId: input.organizationId,
    parentId: input.parentId,
    syncState: syncedContainerDocumentObjectSyncState,
    systemSlot: input.systemSlot ?? null,
  };
}

test("resolves Contacts from the primary org after an active-org switch", () => {
  const nodes = [
    node({
      id: "personal-root",
      organizationId: "personal-org",
      parentId: null,
    }),
    node({
      id: "personal-contacts",
      organizationId: "personal-org",
      parentId: "personal-root",
      systemSlot: CONTACTS_SLOT,
    }),
    node({
      id: "personal-trash",
      organizationId: "personal-org",
      parentId: "personal-root",
      systemSlot: TRASH_SLOT,
    }),
    node({
      id: "custom-root",
      organizationId: "custom-org",
      parentId: null,
    }),
    node({
      id: "custom-trash",
      organizationId: "custom-org",
      parentId: "custom-root",
      systemSlot: TRASH_SLOT,
    }),
  ];

  expect(
    resolveExplorerPrimarySystemContainerIds({
      contactsSystemSlot: CONTACTS_SLOT,
      nodes,
      primaryOrganizationId: "personal-org",
    }),
  ).toEqual({
    contactsContainerId: "personal-contacts",
  });
});

test("does not select another org's system containers without a primary org", () => {
  expect(
    resolveExplorerPrimarySystemContainerIds({
      contactsSystemSlot: CONTACTS_SLOT,
      nodes: [
        node({
          id: "custom-contacts",
          organizationId: "custom-org",
          parentId: "custom-root",
          systemSlot: CONTACTS_SLOT,
        }),
      ],
      primaryOrganizationId: null,
    }),
  ).toEqual({ contactsContainerId: null });
});
