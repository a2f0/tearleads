import { expect, test } from "bun:test";
import type {
  ContainerNode,
  DocumentSummary,
  StoredDocumentKind,
} from "@tearleads/client-sdk";
import type { SelfContactIdentityView } from "../../../stores/contacts/currentSelfContactIdentityState";
import {
  CONTACTS_CONTAINER_NAME,
  deriveBuiltInSystemContainers,
} from "../../../stores/systemContainers";
import {
  canCreateStructuredDocumentInContainerByRules,
  createExplorerContainerRulesContext,
  type ExplorerContainerRulesContext,
} from "./containerRules";
import { canSaveDocumentCopyByRules } from "./documentCopyRules";
import {
  createAbsentSelfIdentity,
  createReadySelfIdentity,
  createSelfIdentityRules,
  identityDocument,
  selfIdentityNodes,
} from "./selfContactIdentity.testUtils";

// Saving a version as a copy: the folder must take a new document of the
// version's kind, and a contact version must not be Me.
function node(id: string, overrides: Partial<ContainerNode> = {}) {
  const found = selfIdentityNodes.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`no test container ${id}`);
  return { ...found, ...overrides };
}

/**
 * Whether `container` takes a copy of `document`'s version of `kind`, with the
 * document in it and the container in the tree beside the test folders. With
 * no container, the document is in a folder the tree does not hold.
 */
function copies(
  rules: ExplorerContainerRulesContext,
  container: ContainerNode | undefined,
  document: DocumentSummary,
  kind: StoredDocumentKind,
): boolean {
  const folders = new Map(
    selfIdentityNodes.map((folder) => [folder.id, folder]),
  );
  if (container) folders.set(container.id, container);
  return canSaveDocumentCopyByRules(
    rules,
    folders,
    { ...document, containerId: container?.id ?? "not-in-the-tree" },
    kind,
  );
}

const ordinary = identityDocument();

test("a version is copied into an ordinary writable folder, whatever its kind", async () => {
  const rules = createSelfIdentityRules(await createReadySelfIdentity());
  const folder = node("linked-folder");

  expect(copies(rules, folder, ordinary, "note")).toBe(true);
  expect(copies(rules, folder, ordinary, "contact")).toBe(true);
});

test("a version is not copied into a folder that cannot be written or is unknown", async () => {
  const rules = createSelfIdentityRules(await createReadySelfIdentity());

  expect(
    copies(
      rules,
      node("linked-folder", { effectiveAccessLevel: "read" }),
      ordinary,
      "note",
    ),
  ).toBe(false);
  // A document whose folder is not in the tree: its write access is unproven.
  expect(copies(rules, undefined, ordinary, "note")).toBe(false);
});

test("a version is never copied into the Trash", async () => {
  const rules = createSelfIdentityRules(await createReadySelfIdentity());
  const trash = node("trash");

  expect(copies(rules, trash, ordinary, "note")).toBe(false);
  expect(copies(rules, trash, ordinary, "contact")).toBe(false);
});

test("app-owned folders take no copy, although they leave creation open", async () => {
  const builtInSystemContainers = await deriveBuiltInSystemContainers({
    organizationId: "identity-org",
  });
  expect(builtInSystemContainers.length).toBeGreaterThan(0);
  const rules = createExplorerContainerRulesContext({
    builtInSystemContainers,
    contactsContainerId: "contacts",
    contactsSystemSlot: "contacts-slot",
    currentOrganizationId: "identity-org",
    selfContactIdentity: await createReadySelfIdentity(),
    trashSystemSlot: "trash-slot",
  });

  for (const builtIn of builtInSystemContainers) {
    const container = node("linked-folder", {
      id: builtIn.kind,
      name: builtIn.name,
      systemSlot: builtIn.systemSlot,
    });
    // The rule that would otherwise admit it: a new document may be made here.
    expect(
      canCreateStructuredDocumentInContainerByRules(rules, container),
    ).toBe(true);
    for (const kind of ["note", "contact"] as const) {
      expect(copies(rules, container, ordinary, kind)).toBe(false);
    }
  }
});

test("a system folder whose rules are not loaded yet takes no copy", async () => {
  // The Contacts and Trash slots are still being derived: neither folder
  // resolves any rules, but each is still known by its own slot.
  const rules = createExplorerContainerRulesContext({
    contactsContainerId: null,
    contactsSystemSlot: null,
    currentOrganizationId: "identity-org",
    selfContactIdentity: await createReadySelfIdentity(),
    trashSystemSlot: null,
  });

  for (const container of [node("contacts"), node("trash")]) {
    for (const kind of ["note", "contact"] as const) {
      expect(copies(rules, container, ordinary, kind)).toBe(false);
    }
  }
  // An ordinary folder needs no rules to take one.
  expect(copies(rules, node("linked-folder"), ordinary, "note")).toBe(true);
});

test("a shared Contacts takes no copy", async () => {
  const rules = createSelfIdentityRules(await createReadySelfIdentity());
  // Another organization's Contacts, shared with the viewer: its slot is the
  // owner's, so it is known by name.
  const shared = node("linked-folder", {
    id: "shared-contacts",
    name: CONTACTS_CONTAINER_NAME,
    organizationId: "another-org",
  });

  // Shared with its owner's slot: Contacts rules resolve for it by name, but
  // the slot is not the viewer's own.
  const slotted = { ...shared, systemSlot: "owner-contacts-slot" };

  for (const container of [shared, slotted]) {
    expect(copies(rules, container, ordinary, "contact")).toBe(false);
    expect(copies(rules, container, ordinary, "note")).toBe(false);
  }
});

test("Contacts takes a contact version and nothing else", async () => {
  const rules = createSelfIdentityRules(await createReadySelfIdentity());
  const contacts = node("contacts");

  expect(copies(rules, contacts, ordinary, "contact")).toBe(true);
  // A contact's first stops can replay as a note; Contacts does not take one.
  expect(copies(rules, contacts, ordinary, "note")).toBe(false);
  expect(
    copies(
      rules,
      node("contacts", { effectiveAccessLevel: "read" }),
      ordinary,
      "contact",
    ),
  ).toBe(false);
});

test("a contact version of Me is never copied, wherever Me is listed", async () => {
  const identity = await createReadySelfIdentity();
  const rules = createSelfIdentityRules(identity);
  const me = identityDocument({
    documentId: identity.identity.documentId,
    documentKind: "contact",
    id: identity.identity.localId,
  });
  // A Me alias that lists as a note under another local id.
  const alias = identityDocument({
    documentId: identity.identity.documentId,
    documentKind: "note",
    id: "discovered-me-alias",
  });

  for (const document of [me, alias]) {
    for (const container of [node("contacts"), node("linked-folder")]) {
      expect(copies(rules, container, document, "contact")).toBe(false);
    }
  }
  // A version of Me from before it was a contact holds none of Me's fields.
  expect(copies(rules, node("linked-folder"), me, "note")).toBe(true);
});

test("a contact version waits until Me is known; other kinds do not", async () => {
  const stale = await createReadySelfIdentity(() => false);
  const unknown: SelfContactIdentityView[] = [
    { status: "pending" },
    { error: new Error("read failed"), status: "failed" },
    stale,
  ];
  const folder = node("linked-folder");

  for (const identity of unknown) {
    const rules = createSelfIdentityRules(identity);
    expect(copies(rules, folder, ordinary, "contact")).toBe(false);
    expect(copies(rules, folder, ordinary, "note")).toBe(true);
  }
});

test("without a signing identity there is no Me to refuse", () => {
  const rules = createSelfIdentityRules(createAbsentSelfIdentity());

  expect(copies(rules, node("contacts"), ordinary, "contact")).toBe(true);
});

test("a document with no folder has nowhere to save a copy", async () => {
  const rules = createSelfIdentityRules(await createReadySelfIdentity());
  const folders = new Map(
    selfIdentityNodes.map((folder) => [folder.id, folder]),
  );

  expect(
    canSaveDocumentCopyByRules(
      rules,
      folders,
      { ...ordinary, containerId: null },
      "note",
    ),
  ).toBe(false);
});

test("a folder under the Trash takes no copy, though it keeps no rules", async () => {
  const rules = createSelfIdentityRules(await createReadySelfIdentity());
  // A writable folder moved into the Trash: nothing of its own refuses.
  const trashed = node("linked-folder", { id: "trashed", parentId: "trash" });
  const nested = node("linked-folder", { id: "nested", parentId: "trashed" });
  const folders = new Map(
    [...selfIdentityNodes, trashed, nested].map((folder) => [
      folder.id,
      folder,
    ]),
  );

  for (const folder of [trashed, nested]) {
    for (const kind of ["note", "contact"] as const) {
      expect(
        canSaveDocumentCopyByRules(
          rules,
          folders,
          { ...ordinary, containerId: folder.id },
          kind,
        ),
      ).toBe(false);
    }
  }
});
