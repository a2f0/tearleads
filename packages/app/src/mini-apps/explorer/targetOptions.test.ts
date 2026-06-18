import { expect, test } from "bun:test";
import type { ContainerNode, DocumentSummary } from "@tearleads/client-sdk";
import { syncedContainerDocumentObjectSyncState } from "@tearleads/client-sdk";
import { createExplorerContainerRulesContext } from "./containerRules";
import { getDocumentMoveTargetOptions } from "./targetOptions";

const CONTACTS_SLOT = "contacts-slot";
const TRASH_SLOT = "trash-slot";
const CONTACTS_CONTAINER_ID = "contacts-container";
const TRASH_CONTAINER_ID = "trash-container";

const rulesContext = createExplorerContainerRulesContext({
  contactsContainerId: CONTACTS_CONTAINER_ID,
  contactsSystemSlot: CONTACTS_SLOT,
  trashSystemSlot: TRASH_SLOT,
});

function containerNode(
  overrides: Partial<ContainerNode> & Pick<ContainerNode, "id">,
): ContainerNode {
  return {
    kind: "container",
    name: overrides.name ?? overrides.id,
    organizationId: "org-1",
    parentId: "root-container",
    syncState: syncedContainerDocumentObjectSyncState,
    ...overrides,
  };
}

const nodes: ReadonlyArray<ContainerNode> = [
  containerNode({ id: "root-container", name: "/", parentId: null }),
  containerNode({ id: CONTACTS_CONTAINER_ID, systemSlot: CONTACTS_SLOT }),
  containerNode({ id: TRASH_CONTAINER_ID, systemSlot: TRASH_SLOT }),
  containerNode({ id: "user-container", name: "Documents" }),
];

function documentSummary(
  overrides: Partial<DocumentSummary> & Pick<DocumentSummary, "id">,
): DocumentSummary {
  return {
    containerId: "user-container",
    documentId: "document-1",
    title: "Document",
    updatedAt: "2026-06-01T00:00:00.000Z",
    ...overrides,
  };
}

test("a document in trash can be moved out to another container", () => {
  const trashedDocument = documentSummary({
    id: "trashed-doc",
    containerId: TRASH_CONTAINER_ID,
  });
  const options = getDocumentMoveTargetOptions(
    nodes,
    [trashedDocument],
    trashedDocument.id,
    undefined,
    rulesContext,
  );
  const optionIds = options.map((option) => option.id);

  // The trash container itself is excluded (can't move to current container),
  // but every other container is a valid restore target.
  expect(optionIds).not.toContain(TRASH_CONTAINER_ID);
  expect(optionIds).toContain("user-container");
  expect(optionIds).toContain(CONTACTS_CONTAINER_ID);
  expect(optionIds).toContain("root-container");
});

test("a contact cannot be moved out of the contacts container", () => {
  const contactDocument = documentSummary({
    id: "self_contact_v1_abc",
    containerId: CONTACTS_CONTAINER_ID,
  });
  const options = getDocumentMoveTargetOptions(
    nodes,
    [contactDocument],
    contactDocument.id,
    undefined,
    rulesContext,
  );

  expect(options).toEqual([]);
});

test("a document in a plain container can be moved out", () => {
  const userDocument = documentSummary({
    id: "user-doc",
    containerId: "user-container",
  });
  const options = getDocumentMoveTargetOptions(
    nodes,
    [userDocument],
    userDocument.id,
    undefined,
    rulesContext,
  );

  expect(options.map((option) => option.id)).toContain(TRASH_CONTAINER_ID);
  expect(options.map((option) => option.id)).not.toContain("user-container");
});
