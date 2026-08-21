import { expect, test } from "bun:test";
import type { ContainerNode, DocumentSummary } from "@symcrypt/client-sdk";
import { syncedContainerDocumentObjectSyncState } from "@symcrypt/client-sdk";
import {
  canMoveDocumentToContainerByRules,
  createExplorerContainerRulesContext,
} from "./containerRules";

const CONTACTS_SLOT = "contacts-slot";
const TRASH_SLOT = "trash-slot";
const CONTACTS_CONTAINER_ID = "contacts-container";

const rulesContext = createExplorerContainerRulesContext({
  contactsContainerId: CONTACTS_CONTAINER_ID,
  contactsSystemSlot: CONTACTS_SLOT,
  currentOrganizationId: null,
  currentSigningFingerprint: "abc",
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

function contactDocument(overrides: Partial<DocumentSummary>): DocumentSummary {
  return {
    containerId: CONTACTS_CONTAINER_ID,
    documentId: "document-1",
    documentKind: "contact",
    id: "local-contact-2",
    title: "Document",
    updatedAt: "2026-06-01T00:00:00.000Z",
    ...overrides,
  };
}

test("contacts contents can only move to trash from the contacts container", () => {
  const contact = contactDocument({});
  expect(
    canMoveDocumentToContainerByRules(
      rulesContext,
      contactsContainer,
      trashContainer,
      contact,
    ),
  ).toBe(true);
  expect(
    canMoveDocumentToContainerByRules(
      rulesContext,
      contactsContainer,
      userContainer,
      contact,
    ),
  ).toBe(false);
});

test("the contacts-to-trash exception does not apply to the self contact", () => {
  const selfContact = contactDocument({ id: "self_contact_v1_abc" });
  expect(
    canMoveDocumentToContainerByRules(
      rulesContext,
      contactsContainer,
      trashContainer,
      selfContact,
    ),
  ).toBe(false);
});

test("documents without a source container can move into writable destinations", () => {
  const document = contactDocument({ containerId: null, documentKind: "note" });
  expect(
    canMoveDocumentToContainerByRules(
      rulesContext,
      null,
      userContainer,
      document,
    ),
  ).toBe(true);
});

test("missing source containers still fail closed", () => {
  const document = contactDocument({ documentKind: "note" });
  expect(
    canMoveDocumentToContainerByRules(
      rulesContext,
      undefined,
      userContainer,
      document,
    ),
  ).toBe(false);
});
