import { expect, test } from "bun:test";
import { EXPLORER_TRASH_CONTAINER_NAME } from "../systemContainers";
import { isContainerUnderTrash } from "./ExplorerSystemContainers";

const OWN_ORG = "org-self";
const PEER_ORG = "org-peer";
const OWN_TRASH_SLOT = "trash-slot-self";

interface TestNode {
  id: string;
  name: string;
  organizationId: string;
  parentId: string | null;
  systemSlot: string | null;
}

function node(partial: Partial<TestNode> & { id: string }): TestNode {
  return {
    name: "Folder",
    organizationId: OWN_ORG,
    parentId: null,
    systemSlot: null,
    ...partial,
  };
}

const input = {
  currentOrganizationId: OWN_ORG,
  trashSystemSlot: OWN_TRASH_SLOT,
};

test("the viewer's own Trash root is trashed (matched by slot)", () => {
  const trash = node({
    id: "trash",
    name: EXPLORER_TRASH_CONTAINER_NAME,
    systemSlot: OWN_TRASH_SLOT,
  });

  expect(isContainerUnderTrash([trash], "trash", input)).toBe(true);
});

test("a document parked in a subfolder of the own Trash is trashed", () => {
  const trash = node({
    id: "trash",
    name: EXPLORER_TRASH_CONTAINER_NAME,
    systemSlot: OWN_TRASH_SLOT,
  });
  const subfolder = node({ id: "sub", name: "Old", parentId: "trash" });

  expect(isContainerUnderTrash([trash, subfolder], "sub", input)).toBe(true);
});

test("a peer's shared Trash under a foreign org's root is trashed (matched by name)", () => {
  // The owner's derived Trash slot is opaque to the viewer, so slot matching
  // misses; foreign-shared detection falls back to the "Trash" name.
  const foreignTrash = node({
    id: "peer-trash",
    name: EXPLORER_TRASH_CONTAINER_NAME,
    organizationId: PEER_ORG,
    systemSlot: "opaque-owner-slot",
  });
  const foreignSubfolder = node({
    id: "peer-sub",
    name: "Removed",
    organizationId: PEER_ORG,
    parentId: "peer-trash",
  });

  expect(isContainerUnderTrash([foreignTrash], "peer-trash", input)).toBe(true);
  expect(
    isContainerUnderTrash([foreignTrash, foreignSubfolder], "peer-sub", input),
  ).toBe(true);
});

test("foreign-shared Trash is detected even before the viewer's own slot resolves", () => {
  const foreignTrash = node({
    id: "peer-trash",
    name: EXPLORER_TRASH_CONTAINER_NAME,
    organizationId: PEER_ORG,
  });

  expect(
    isContainerUnderTrash([foreignTrash], "peer-trash", {
      currentOrganizationId: OWN_ORG,
      trashSystemSlot: null,
    }),
  ).toBe(true);
});

test("a same-org folder merely named 'Trash' is not trashed (no name spoofing)", () => {
  const spoof = node({
    id: "spoof",
    name: EXPLORER_TRASH_CONTAINER_NAME,
    organizationId: OWN_ORG,
    systemSlot: null,
  });

  expect(isContainerUnderTrash([spoof], "spoof", input)).toBe(false);
});

test("an ordinary container is not trashed, and a null container is never trashed", () => {
  const plain = node({ id: "docs", name: "Docs" });

  expect(isContainerUnderTrash([plain], "docs", input)).toBe(false);
  expect(isContainerUnderTrash([plain], null, input)).toBe(false);
});
