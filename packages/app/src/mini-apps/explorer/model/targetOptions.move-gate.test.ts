import { expect, test } from "bun:test";
import type { ContainerNode } from "@symcrypt/client-sdk";
import { syncedContainerDocumentObjectSyncState } from "@symcrypt/client-sdk";
import { createExplorerContainerRulesContext } from "./containerRules";
import {
  createExplorerTargetLookups,
  getMoveTargetOptions,
} from "./targetOptions";

const TRASH_SLOT = "trash-slot";

function containerNode(
  overrides: Partial<ContainerNode> & Pick<ContainerNode, "id">,
): ContainerNode {
  return {
    kind: "container",
    name: overrides.name ?? overrides.id,
    organizationId: "org-1",
    parentId: "root",
    syncState: syncedContainerDocumentObjectSyncState,
    ...overrides,
  };
}

const rulesContext = createExplorerContainerRulesContext({
  contactsContainerId: null,
  contactsSystemSlot: null,
  currentOrganizationId: null,
  currentSigningFingerprint: null,
  trashSystemSlot: TRASH_SLOT,
});

const nodes: ReadonlyArray<ContainerNode> = [
  containerNode({ id: "root", name: "/", parentId: null }),
  containerNode({ id: "trash", name: "Trash", systemSlot: TRASH_SLOT }),
  containerNode({ id: "folder-a", name: "Folder A" }),
  containerNode({ id: "folder-b", name: "Folder B" }),
];

test("container move excludes Trash as a destination (no child containers allowed)", () => {
  const optionIds = getMoveTargetOptions(
    nodes,
    "folder-a",
    createExplorerTargetLookups(nodes, []),
    rulesContext,
  ).map((option) => option.id);

  // Regression: container move used to ignore the destination's
  // protectFromChildContainerCreation rule, letting a folder be moved into
  // Trash (and so become an un-purgeable nested folder). Trash must not appear.
  expect(optionIds).not.toContain("trash");
  expect(optionIds).toContain("folder-b");
  expect(optionIds).toContain("root");
});
