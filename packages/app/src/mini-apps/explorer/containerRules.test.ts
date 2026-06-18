import { expect, test } from "bun:test";
import type { ContainerNode, DocumentSummary } from "@tearleads/client-sdk";
import { syncedContainerDocumentObjectSyncState } from "@tearleads/client-sdk";
import {
  canDeleteContainerByRules,
  canDeleteDocumentByRules,
  canMoveContainerByRules,
  canMoveDocumentOutByRules,
  canRenameContainerByRules,
  createExplorerContainerRulesContext,
  isSelfContactDocument,
} from "./containerRules";

const CONTACTS_SLOT = "contacts-slot";
const TRASH_SLOT = "trash-slot";
const CONTACTS_CONTAINER_ID = "contacts-container";

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

const contactsContainer = containerNode({
  id: CONTACTS_CONTAINER_ID,
  systemSlot: CONTACTS_SLOT,
});
const trashContainer = containerNode({
  id: "trash-container",
  systemSlot: TRASH_SLOT,
});
const userContainer = containerNode({ id: "user-container" });

function documentSummary(
  overrides: Partial<DocumentSummary> & Pick<DocumentSummary, "id">,
): DocumentSummary {
  return {
    containerId: CONTACTS_CONTAINER_ID,
    documentId: "document-1",
    title: "Document",
    updatedAt: "2026-06-01T00:00:00.000Z",
    ...overrides,
  };
}

test("the contacts and trash containers cannot be moved", () => {
  expect(canMoveContainerByRules(rulesContext, contactsContainer)).toBe(false);
  expect(canMoveContainerByRules(rulesContext, trashContainer)).toBe(false);
});

test("the contacts and trash containers cannot be deleted", () => {
  expect(canDeleteContainerByRules(rulesContext, contactsContainer)).toBe(
    false,
  );
  expect(canDeleteContainerByRules(rulesContext, trashContainer)).toBe(false);
});

test("the contacts and trash containers cannot be renamed", () => {
  expect(canRenameContainerByRules(rulesContext, contactsContainer)).toBe(
    false,
  );
  expect(canRenameContainerByRules(rulesContext, trashContainer)).toBe(false);
});

test("plain user containers stay movable, deletable, and renamable", () => {
  expect(canMoveContainerByRules(rulesContext, userContainer)).toBe(true);
  expect(canDeleteContainerByRules(rulesContext, userContainer)).toBe(true);
  expect(canRenameContainerByRules(rulesContext, userContainer)).toBe(true);
});

test("contacts cannot be moved out of the contacts container", () => {
  expect(canMoveDocumentOutByRules(rulesContext, contactsContainer)).toBe(
    false,
  );
});

test("items can be moved out of the trash container", () => {
  expect(canMoveDocumentOutByRules(rulesContext, trashContainer)).toBe(true);
});

test("documents in plain containers can move out freely", () => {
  expect(canMoveDocumentOutByRules(rulesContext, userContainer)).toBe(true);
});

test("the self contact in the contacts container cannot be deleted", () => {
  expect(
    canDeleteDocumentByRules(
      rulesContext,
      documentSummary({ id: "self_contact_v1_abc" }),
    ),
  ).toBe(false);
});

test("non-self contacts can be deleted", () => {
  expect(
    canDeleteDocumentByRules(
      rulesContext,
      documentSummary({ id: "local-contact-2" }),
    ),
  ).toBe(true);
});

test("a self-contact-shaped id outside the contacts container is not protected", () => {
  expect(
    canDeleteDocumentByRules(
      rulesContext,
      documentSummary({
        id: "self_contact_v1_abc",
        containerId: "user-container",
      }),
    ),
  ).toBe(true);
});

test("isSelfContactDocument matches the deterministic self-contact id prefix", () => {
  expect(isSelfContactDocument({ id: "self_contact_v1_abc" })).toBe(true);
  expect(isSelfContactDocument({ id: "local-contact-2" })).toBe(false);
  expect(isSelfContactDocument(undefined)).toBe(false);
});

test("rules are disabled when the configuration flags are absent for a slot", () => {
  // A container with an unknown system slot has no configured rules, so every
  // action is permitted.
  const unknownSlotContainer = containerNode({
    id: "mystery-container",
    systemSlot: "mystery-slot",
  });
  expect(canMoveContainerByRules(rulesContext, unknownSlotContainer)).toBe(
    true,
  );
  expect(canDeleteContainerByRules(rulesContext, unknownSlotContainer)).toBe(
    true,
  );
  expect(canRenameContainerByRules(rulesContext, unknownSlotContainer)).toBe(
    true,
  );
  expect(canMoveDocumentOutByRules(rulesContext, unknownSlotContainer)).toBe(
    true,
  );
});
