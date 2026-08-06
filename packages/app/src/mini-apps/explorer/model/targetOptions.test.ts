import { expect, test } from "bun:test";
import type { ContainerNode, DocumentSummary } from "@tearleads/client-sdk";
import { syncedContainerDocumentObjectSyncState } from "@tearleads/client-sdk";
import {
  createExplorerOrphanedDocumentsNode,
  EXPLORER_ORPHANED_DOCUMENTS_ID,
} from "../../../stores/explorer/orphanedDocuments";
import { deriveBuiltInSystemContainers } from "../../../stores/systemContainers";
import { createExplorerContainerRulesContext } from "./containerRules";
import {
  getDocumentLinkTargetOptions,
  getDocumentMoveTargetOptions,
  getMoveTargetOptions,
} from "./targetOptions";

const CONTACTS_SLOT = "contacts-slot";
const TRASH_SLOT = "trash-slot";
const CONTACTS_CONTAINER_ID = "contacts-container";
const TRASH_CONTAINER_ID = "trash-container";

const rulesContext = createExplorerContainerRulesContext({
  contactsContainerId: CONTACTS_CONTAINER_ID,
  contactsSystemSlot: CONTACTS_SLOT,
  currentOrganizationId: null,
  currentSigningFingerprint: null,
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
  containerNode({ id: "user-container", icon: "folder", name: "Documents" }),
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
    documentKind: "note",
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
  // and the Contacts system container rejects non-contact documents.
  expect(optionIds).not.toContain(TRASH_CONTAINER_ID);
  expect(optionIds).not.toContain(CONTACTS_CONTAINER_ID);
  expect(optionIds).toContain("user-container");
  expect(optionIds).toContain("root-container");
});

test("a linked null-container document cannot be moved from recovery", () => {
  const linkedDocument = documentSummary({
    id: "linked-document",
    containerId: null,
  });
  const options = getDocumentMoveTargetOptions(
    nodes,
    [linkedDocument],
    linkedDocument.id,
    undefined,
    rulesContext,
    new Map([["document-1", ["foreign-container"]]]),
  );

  expect(options).toEqual([]);
});

test("an unlinked null-container document can be moved from recovery", () => {
  const orphanedDocument = documentSummary({
    id: "orphaned-document",
    containerId: null,
  });
  const options = getDocumentMoveTargetOptions(
    nodes,
    [orphanedDocument],
    orphanedDocument.id,
    undefined,
    createExplorerContainerRulesContext({
      contactsContainerId: CONTACTS_CONTAINER_ID,
      contactsSystemSlot: CONTACTS_SLOT,
      currentOrganizationId: "org-1",
      currentSigningFingerprint: null,
      trashSystemSlot: TRASH_SLOT,
    }),
    new Map([["document-1", []]]),
  );

  expect(options.map(({ id }) => id)).toContain("user-container");
});

test("a document in trash cannot be linked to another container", () => {
  const trashedDocument = documentSummary({
    id: "trashed-doc",
    containerId: TRASH_CONTAINER_ID,
    documentKind: "note",
  });
  const options = getDocumentLinkTargetOptions(
    nodes,
    [trashedDocument],
    trashedDocument.id,
    [TRASH_CONTAINER_ID],
    undefined,
    rulesContext,
  );

  expect(options).toEqual([]);
});

test("the trash container is not offered as a link target", () => {
  // The trash is a move-only system folder: a document reaches it by deletion,
  // never by linking. Linking a document that lives in a plain container must
  // therefore exclude the trash from the destination list, even though that same
  // document CAN be moved to the trash (see the move-target test below).
  const userDocument = documentSummary({
    id: "user-doc",
    containerId: "user-container",
    documentKind: "note",
  });
  const options = getDocumentLinkTargetOptions(
    nodes,
    [userDocument],
    userDocument.id,
    ["user-container"],
    undefined,
    rulesContext,
  );
  const optionIds = options.map((option) => option.id);

  expect(optionIds).not.toContain(TRASH_CONTAINER_ID);
  // A plain sibling container is still a valid link target.
  expect(optionIds).toContain("root-container");
});

test("a contact can be linked out of contacts but not into the trash", () => {
  // Mirrors the reported repro: right-clicking a contact and choosing "Link"
  // must not list the trash, while ordinary folders remain available.
  const contactDocument = documentSummary({
    id: "contact-doc",
    containerId: CONTACTS_CONTAINER_ID,
    documentKind: "contact",
  });
  const options = getDocumentLinkTargetOptions(
    nodes,
    [contactDocument],
    contactDocument.id,
    [CONTACTS_CONTAINER_ID],
    undefined,
    rulesContext,
  );
  const optionIds = options.map((option) => option.id);

  expect(optionIds).not.toContain(TRASH_CONTAINER_ID);
  expect(optionIds).toContain("user-container");
});

test("document move target options carry folder names and icons", () => {
  const trashedDocument = documentSummary({
    id: "trashed-doc",
    containerId: TRASH_CONTAINER_ID,
    documentKind: "note",
  });
  const options = getDocumentMoveTargetOptions(
    nodes,
    [trashedDocument],
    trashedDocument.id,
    undefined,
    rulesContext,
  );

  expect(options.find((option) => option.id === "user-container")).toEqual({
    id: "user-container",
    icon: "folder",
    label: "Documents",
  });
});

test("a contact in trash can be moved back into the contacts container", () => {
  const trashedContact = documentSummary({
    id: "trashed-contact",
    containerId: TRASH_CONTAINER_ID,
    documentKind: "contact",
  });
  const options = getDocumentMoveTargetOptions(
    nodes,
    [trashedContact],
    trashedContact.id,
    undefined,
    rulesContext,
  );

  expect(options.map((option) => option.id)).toContain(CONTACTS_CONTAINER_ID);
});

test("a custom contact in contacts can only be moved to trash", () => {
  const contactDocument = documentSummary({
    id: "local-contact-2",
    containerId: CONTACTS_CONTAINER_ID,
    documentKind: "contact",
  });
  const options = getDocumentMoveTargetOptions(
    nodes,
    [contactDocument],
    contactDocument.id,
    undefined,
    rulesContext,
  );

  expect(options).toEqual([
    {
      id: TRASH_CONTAINER_ID,
      icon: undefined,
      label: TRASH_CONTAINER_ID,
    },
  ]);
});

test("the self contact in contacts cannot be moved to trash", () => {
  const selfContactRulesContext = createExplorerContainerRulesContext({
    contactsContainerId: CONTACTS_CONTAINER_ID,
    contactsSystemSlot: CONTACTS_SLOT,
    currentOrganizationId: null,
    currentSigningFingerprint: "abc",
    trashSystemSlot: TRASH_SLOT,
  });
  const contactDocument = documentSummary({
    id: "self_contact_v1_abc",
    containerId: CONTACTS_CONTAINER_ID,
    documentKind: "contact",
  });
  const options = getDocumentMoveTargetOptions(
    nodes,
    [contactDocument],
    contactDocument.id,
    undefined,
    selfContactRulesContext,
  );

  expect(options).toEqual([]);
});

test("the self contact cannot be moved out of a linked user container", () => {
  // Viewed via a link the self contact carries the user container's id, so the
  // container pin does not apply; the identity guard must still yield no move
  // targets — otherwise it could be moved to Trash, a delete-equivalent that
  // bypasses the self-contact delete protection.
  const selfContactRulesContext = createExplorerContainerRulesContext({
    contactsContainerId: CONTACTS_CONTAINER_ID,
    contactsSystemSlot: CONTACTS_SLOT,
    currentOrganizationId: null,
    currentSigningFingerprint: "abc",
    trashSystemSlot: TRASH_SLOT,
  });
  const linkedSelfContact = documentSummary({
    id: "self_contact_v1_abc",
    containerId: "user-container",
  });
  const options = getDocumentMoveTargetOptions(
    nodes,
    [linkedSelfContact],
    linkedSelfContact.id,
    undefined,
    selfContactRulesContext,
  );

  expect(options).toEqual([]);
});

const ROSTER_PROFILES_CONTAINER_ID = "roster-profiles-container";
const ORGANIZATION_METADATA_CONTAINER_ID = "organization-metadata-container";

async function createBuiltInSystemContainerFixture(): Promise<{
  builtInNodes: ReadonlyArray<ContainerNode>;
  builtInRulesContext: ReturnType<typeof createExplorerContainerRulesContext>;
}> {
  const builtInSystemContainers = await deriveBuiltInSystemContainers({
    organizationId: "org-1",
  });
  const containerIdsByKind = {
    organizationMetadata: ORGANIZATION_METADATA_CONTAINER_ID,
    organizationRosterProfiles: ROSTER_PROFILES_CONTAINER_ID,
  } as const;

  return {
    builtInNodes: [
      ...nodes,
      ...builtInSystemContainers.map((builtInSystemContainer) =>
        containerNode({
          id: containerIdsByKind[builtInSystemContainer.kind],
          name: builtInSystemContainer.name,
          systemSlot: builtInSystemContainer.systemSlot,
        }),
      ),
    ],
    builtInRulesContext: createExplorerContainerRulesContext({
      builtInSystemContainers,
      contactsContainerId: CONTACTS_CONTAINER_ID,
      contactsSystemSlot: CONTACTS_SLOT,
      currentOrganizationId: null,
      currentSigningFingerprint: null,
      trashSystemSlot: TRASH_SLOT,
    }),
  };
}

test("built-in organization system containers are not offered as link targets", async () => {
  // The built-in system containers feature flag reveals Roster Profiles and
  // Organization Metadata in the tree. They are app-owned endpoints written by
  // the org workflows, so making them visible must not make them "Link
  // Document" destinations.
  const { builtInNodes, builtInRulesContext } =
    await createBuiltInSystemContainerFixture();
  const userDocument = documentSummary({
    id: "user-doc",
    containerId: "user-container",
    documentKind: "note",
  });

  const optionIds = getDocumentLinkTargetOptions(
    builtInNodes,
    [userDocument],
    userDocument.id,
    ["user-container"],
    undefined,
    builtInRulesContext,
  ).map((option) => option.id);

  expect(optionIds).not.toContain(ROSTER_PROFILES_CONTAINER_ID);
  expect(optionIds).not.toContain(ORGANIZATION_METADATA_CONTAINER_ID);
  // A plain sibling container is still a valid link target.
  expect(optionIds).toContain("root-container");
});

test("built-in organization system containers remain move targets", async () => {
  // Only inbound links are blocked: the built-in containers carry no other
  // rules, so a revealed container still behaves like an ordinary folder for
  // moves. This is the deliberate scope of their rules — anything stricter
  // would fight the debugging the feature flag exists for.
  const { builtInNodes, builtInRulesContext } =
    await createBuiltInSystemContainerFixture();
  const userDocument = documentSummary({
    id: "user-doc",
    containerId: "user-container",
    documentKind: "note",
  });

  const optionIds = getDocumentMoveTargetOptions(
    builtInNodes,
    [userDocument],
    userDocument.id,
    undefined,
    builtInRulesContext,
  ).map((option) => option.id);

  expect(optionIds).toContain(ROSTER_PROFILES_CONTAINER_ID);
  expect(optionIds).toContain(ORGANIZATION_METADATA_CONTAINER_ID);
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

  const optionIds = options.map((option) => option.id);
  expect(optionIds).toContain(TRASH_CONTAINER_ID);
  expect(optionIds).not.toContain("user-container");
});

test("recovery is never a container, document move, or link target", () => {
  const nodesWithRecovery = [
    ...nodes,
    createExplorerOrphanedDocumentsNode("org-1", "Orphaned Documents"),
  ];
  const userDocument = documentSummary({ id: "user-doc" });
  const containerTargetIds = getMoveTargetOptions(
    nodesWithRecovery,
    "user-container",
  ).map((option) => option.id);
  const documentMoveTargetIds = getDocumentMoveTargetOptions(
    nodesWithRecovery,
    [userDocument],
    userDocument.id,
  ).map((option) => option.id);
  const documentLinkTargetIds = getDocumentLinkTargetOptions(
    nodesWithRecovery,
    [userDocument],
    userDocument.id,
    ["user-container"],
  ).map((option) => option.id);

  expect(containerTargetIds).not.toContain(EXPLORER_ORPHANED_DOCUMENTS_ID);
  expect(documentMoveTargetIds).not.toContain(EXPLORER_ORPHANED_DOCUMENTS_ID);
  expect(documentLinkTargetIds).not.toContain(EXPLORER_ORPHANED_DOCUMENTS_ID);
});
