import { expect, test } from "bun:test";
import type { ContainerNode, DocumentSummary } from "@tearleads/client-sdk";
import { syncedContainerDocumentObjectSyncState } from "@tearleads/client-sdk";
import {
  canAddDocumentToContainerByRules,
  canAdminContainerNode,
  canCreateChildContainerByRules,
  canCreateStructuredDocumentInContainerByRules,
  canDeleteContainerByRules,
  canDeleteDocumentByRules,
  canLinkDocumentIntoContainerByRules,
  canLinkDocumentOutByRules,
  canMoveContainerByRules,
  canMoveDocumentByRules,
  canMoveDocumentOutByRules,
  canPurgeDocumentByRules,
  canRenameContainerByRules,
  canUploadToContainerByRules,
  canUploadToContainerIdByRules,
  createExplorerContainerRulesContext,
  isSelfContactDocument,
} from "./containerRules";

const CONTACTS_SLOT = "contacts-slot";
const TRASH_SLOT = "trash-slot";
const CONTACTS_CONTAINER_ID = "contacts-container";
// The viewer's self-contact id is derived from this fingerprint, so the id
// "self_contact_v1_abc" is the viewer's own "You" contact.
const SELF_SIGNING_FINGERPRINT = "abc";
const RECOVERED_SELF_CONTACT_ID = "remote-self-document-id";

const rulesContext = createExplorerContainerRulesContext({
  contactsContainerId: CONTACTS_CONTAINER_ID,
  contactsSystemSlot: CONTACTS_SLOT,
  currentOrganizationId: null,
  currentSelfContactLocalId: RECOVERED_SELF_CONTACT_ID,
  currentSigningFingerprint: SELF_SIGNING_FINGERPRINT,
  trashSystemSlot: TRASH_SLOT,
});

// A viewer who is a member of another organization sees that org's system
// folders carrying the OWNER's opaque HMAC slot, which never matches the
// viewer's own derived slots. These contexts model that cross-org view so the
// name-based fallback (see resolveContainerRules) can be exercised.
const VIEWER_ORG_ID = "viewer-org";
const FOREIGN_ORG_ID = "owner-org";
const sharedRulesContext = createExplorerContainerRulesContext({
  contactsContainerId: CONTACTS_CONTAINER_ID,
  contactsSystemSlot: CONTACTS_SLOT,
  currentOrganizationId: VIEWER_ORG_ID,
  currentSigningFingerprint: SELF_SIGNING_FINGERPRINT,
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

test("canAdminContainerNode is true only for the admin access level", () => {
  const adminOf = (level?: ContainerNode["effectiveAccessLevel"]) =>
    canAdminContainerNode(
      containerNode({ id: "n", effectiveAccessLevel: level }),
    );
  expect(adminOf("admin")).toBe(true);
  expect(adminOf("write")).toBe(false);
  expect(adminOf("read")).toBe(false);
  // An unresolved access level fails closed rather than granting admin controls.
  expect(adminOf(undefined)).toBe(false);
  expect(canAdminContainerNode(null)).toBe(false);
  expect(canAdminContainerNode(undefined)).toBe(false);
});

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

test("the contacts and trash containers reject uploads", () => {
  expect(canUploadToContainerByRules(rulesContext, contactsContainer)).toBe(
    false,
  );
  expect(canUploadToContainerByRules(rulesContext, trashContainer)).toBe(false);
});

test("the contacts and trash containers reject direct child creation", () => {
  expect(canCreateChildContainerByRules(rulesContext, contactsContainer)).toBe(
    false,
  );
  expect(canCreateChildContainerByRules(rulesContext, trashContainer)).toBe(
    false,
  );
});

test("the contacts and trash containers reject direct structured document creation", () => {
  expect(
    canCreateStructuredDocumentInContainerByRules(
      rulesContext,
      contactsContainer,
    ),
  ).toBe(false);
  expect(
    canCreateStructuredDocumentInContainerByRules(rulesContext, trashContainer),
  ).toBe(false);
});

test("plain user containers accept uploads", () => {
  expect(canUploadToContainerByRules(rulesContext, userContainer)).toBe(true);
});

test("plain user containers accept direct child and structured document creation", () => {
  expect(canCreateChildContainerByRules(rulesContext, userContainer)).toBe(
    true,
  );
  expect(
    canCreateStructuredDocumentInContainerByRules(rulesContext, userContainer),
  ).toBe(true);
});

test("uploads are gated by container id against the node list", () => {
  const nodes = [contactsContainer, trashContainer, userContainer];
  expect(
    canUploadToContainerIdByRules(rulesContext, nodes, trashContainer.id),
  ).toBe(false);
  expect(
    canUploadToContainerIdByRules(rulesContext, nodes, contactsContainer.id),
  ).toBe(false);
  expect(
    canUploadToContainerIdByRules(rulesContext, nodes, userContainer.id),
  ).toBe(true);
});

test("an unknown container id is not treated as uploadable", () => {
  // A drop targeting an id that is not in the node list has no known effective
  // write permission, so it fails closed.
  expect(
    canUploadToContainerIdByRules(rulesContext, [trashContainer], "missing-id"),
  ).toBe(false);
});

test("contacts cannot be moved out of the contacts container", () => {
  expect(canMoveDocumentOutByRules(rulesContext, contactsContainer)).toBe(
    false,
  );
});

test("items can be moved out of the trash container", () => {
  expect(canMoveDocumentOutByRules(rulesContext, trashContainer)).toBe(true);
});

test("items cannot be linked out of the trash container", () => {
  expect(canLinkDocumentOutByRules(rulesContext, trashContainer)).toBe(false);
});

test("documents in plain containers can link out freely", () => {
  expect(canLinkDocumentOutByRules(rulesContext, userContainer)).toBe(true);
});

test("documents in plain containers can move out freely", () => {
  expect(canMoveDocumentOutByRules(rulesContext, userContainer)).toBe(true);
});

test("contacts container only accepts contact documents", () => {
  expect(
    canAddDocumentToContainerByRules(
      rulesContext,
      contactsContainer,
      documentSummary({ id: "note-1", documentKind: "note" }),
    ),
  ).toBe(false);
  expect(
    canAddDocumentToContainerByRules(
      rulesContext,
      contactsContainer,
      documentSummary({ id: "contact-1", documentKind: "contact" }),
    ),
  ).toBe(true);
});

test("trash and plain containers accept every document kind", () => {
  const note = documentSummary({ id: "note-1", documentKind: "note" });
  expect(
    canAddDocumentToContainerByRules(rulesContext, trashContainer, note),
  ).toBe(true);
  expect(
    canAddDocumentToContainerByRules(rulesContext, userContainer, note),
  ).toBe(true);
});

test("the trash rejects inbound links even though it accepts moves", () => {
  const note = documentSummary({ id: "note-1", documentKind: "note" });
  // The trash is a move-only destination: canAddDocumentToContainerByRules (the
  // move gate) accepts it, but the inbound-link gate must reject it so a link
  // cannot target the trash.
  expect(
    canAddDocumentToContainerByRules(rulesContext, trashContainer, note),
  ).toBe(true);
  expect(
    canLinkDocumentIntoContainerByRules(rulesContext, trashContainer, note),
  ).toBe(false);
});

test("plain containers and contacts accept inbound links by kind", () => {
  const note = documentSummary({ id: "note-1", documentKind: "note" });
  const contact = documentSummary({ id: "contact-1", documentKind: "contact" });
  // Plain folders accept any inbound link; contacts still enforces its
  // accepted-kind rule (a note cannot link in, a contact can).
  expect(
    canLinkDocumentIntoContainerByRules(rulesContext, userContainer, note),
  ).toBe(true);
  expect(
    canLinkDocumentIntoContainerByRules(rulesContext, contactsContainer, note),
  ).toBe(false);
  expect(
    canLinkDocumentIntoContainerByRules(
      rulesContext,
      contactsContainer,
      contact,
    ),
  ).toBe(true);
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

test("the self contact stays protected when viewed via a link in another container", () => {
  // The self contact can be linked into a user container, where its summary
  // carries that container's id rather than the contacts container's. Deletion
  // must still be blocked so the only structural action available is unlink.
  expect(
    canDeleteDocumentByRules(
      rulesContext,
      documentSummary({
        id: "self_contact_v1_abc",
        containerId: "user-container",
      }),
    ),
  ).toBe(false);
});

test("a peer's self contact is not protected from the viewer's deletion", () => {
  // A different signing fingerprint yields a different self-contact id, so a
  // peer's "You" contact surfaced in a shared container is not treated as the
  // viewer's own and can be removed from view.
  expect(
    canDeleteDocumentByRules(
      rulesContext,
      documentSummary({
        id: "self_contact_v1_peer",
        containerId: "user-container",
      }),
    ),
  ).toBe(true);
});

test("the self contact cannot be deleted, moved, or purged from any container", () => {
  // Move and purge share the delete guard's identity check: "delete" is a move
  // to Trash and a trashed doc can be purged, so all three must be blocked for
  // the self contact wherever it is viewed.
  for (const id of ["self_contact_v1_abc", RECOVERED_SELF_CONTACT_ID]) {
    for (const containerId of [CONTACTS_CONTAINER_ID, "user-container"]) {
      const selfContact = documentSummary({ id, containerId });
      expect(canDeleteDocumentByRules(rulesContext, selfContact)).toBe(false);
      expect(canMoveDocumentByRules(rulesContext, selfContact)).toBe(false);
      expect(canPurgeDocumentByRules(rulesContext, selfContact)).toBe(false);
    }
  }
});

test("non-self documents can be moved and purged", () => {
  const peerSelfContact = documentSummary({
    id: "self_contact_v1_peer",
    containerId: "user-container",
  });
  const normalDocument = documentSummary({ id: "local-contact-2" });
  expect(canMoveDocumentByRules(rulesContext, peerSelfContact)).toBe(true);
  expect(canPurgeDocumentByRules(rulesContext, peerSelfContact)).toBe(true);
  expect(canMoveDocumentByRules(rulesContext, normalDocument)).toBe(true);
  expect(canPurgeDocumentByRules(rulesContext, normalDocument)).toBe(true);
  expect(canMoveDocumentByRules(rulesContext, undefined)).toBe(true);
  expect(canPurgeDocumentByRules(rulesContext, undefined)).toBe(true);
});

test("isSelfContactDocument matches only the viewer's own self-contact id", () => {
  expect(
    isSelfContactDocument(
      { id: "self_contact_v1_abc" },
      SELF_SIGNING_FINGERPRINT,
    ),
  ).toBe(true);
  expect(
    isSelfContactDocument(
      { id: "self_contact_v1_peer" },
      SELF_SIGNING_FINGERPRINT,
    ),
  ).toBe(false);
  expect(
    isSelfContactDocument({ id: "local-contact-2" }, SELF_SIGNING_FINGERPRINT),
  ).toBe(false);
  expect(isSelfContactDocument(undefined, SELF_SIGNING_FINGERPRINT)).toBe(
    false,
  );
  expect(isSelfContactDocument({ id: "self_contact_v1_abc" }, null)).toBe(
    false,
  );
});

test("a peer's shared contacts folder enforces contacts rules by name", () => {
  // The owner's HMAC slot does not match the viewer's, so slot resolution
  // misses; the foreign-org + system-name fallback applies the contacts rules.
  const sharedContacts = containerNode({
    id: "peer-contacts",
    name: "Contacts",
    organizationId: FOREIGN_ORG_ID,
    systemSlot: "owner-derived-slot",
  });
  expect(canMoveDocumentOutByRules(sharedRulesContext, sharedContacts)).toBe(
    false,
  );
  expect(canMoveContainerByRules(sharedRulesContext, sharedContacts)).toBe(
    false,
  );
  expect(canDeleteContainerByRules(sharedRulesContext, sharedContacts)).toBe(
    false,
  );
  expect(canUploadToContainerByRules(sharedRulesContext, sharedContacts)).toBe(
    false,
  );
  expect(
    canCreateChildContainerByRules(sharedRulesContext, sharedContacts),
  ).toBe(false);
  expect(
    canCreateStructuredDocumentInContainerByRules(
      sharedRulesContext,
      sharedContacts,
    ),
  ).toBe(false);
  expect(
    canAddDocumentToContainerByRules(
      sharedRulesContext,
      sharedContacts,
      documentSummary({ id: "note-1", documentKind: "note" }),
    ),
  ).toBe(false);
});

test("a peer's shared trash folder enforces trash rules by name", () => {
  // The owner's HMAC slot does not match the viewer's, so slot resolution
  // misses; the foreign-org + system-name fallback applies the trash rules.
  const sharedTrash = containerNode({
    id: "peer-trash",
    name: "Trash",
    organizationId: FOREIGN_ORG_ID,
    systemSlot: "owner-trash-slot",
  });
  expect(canMoveContainerByRules(sharedRulesContext, sharedTrash)).toBe(false);
  expect(canDeleteContainerByRules(sharedRulesContext, sharedTrash)).toBe(
    false,
  );
  expect(canUploadToContainerByRules(sharedRulesContext, sharedTrash)).toBe(
    false,
  );
  expect(canCreateChildContainerByRules(sharedRulesContext, sharedTrash)).toBe(
    false,
  );
  expect(
    canCreateStructuredDocumentInContainerByRules(
      sharedRulesContext,
      sharedTrash,
    ),
  ).toBe(false);
  expect(canMoveDocumentOutByRules(sharedRulesContext, sharedTrash)).toBe(true);
  expect(canLinkDocumentOutByRules(sharedRulesContext, sharedTrash)).toBe(
    false,
  );
});

test("a same-org folder named Contacts cannot spoof contacts rules", () => {
  // Within the viewer's own org, rules resolve strictly by slot. A sibling
  // reusing the name "Contacts" with a foreign/opaque slot must NOT inherit the
  // contacts rules, or a peer could fabricate restrictions on their own folder.
  const sameOrgImposter = containerNode({
    id: "imposter-contacts",
    name: "Contacts",
    organizationId: VIEWER_ORG_ID,
    systemSlot: "unrelated-slot",
  });
  expect(canMoveDocumentOutByRules(sharedRulesContext, sameOrgImposter)).toBe(
    true,
  );
  expect(canMoveContainerByRules(sharedRulesContext, sameOrgImposter)).toBe(
    true,
  );
});

test("the foreign-org name fallback is off before the viewer org is known", () => {
  // With a null currentOrganizationId (pre-hydration) the fallback stays off, so
  // a peer's Contacts folder is not protected until the session org is resolved.
  const sharedContacts = containerNode({
    id: "peer-contacts",
    name: "Contacts",
    organizationId: FOREIGN_ORG_ID,
    systemSlot: "owner-derived-slot",
  });
  expect(canMoveDocumentOutByRules(rulesContext, sharedContacts)).toBe(true);
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
  expect(canLinkDocumentOutByRules(rulesContext, unknownSlotContainer)).toBe(
    true,
  );
  expect(canUploadToContainerByRules(rulesContext, unknownSlotContainer)).toBe(
    true,
  );
});
