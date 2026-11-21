import { expect, test } from "bun:test";
import {
  type ContainerNode,
  deriveStableDocumentId,
  getRosterProfileDocumentLocalId,
} from "@tearleads/client-sdk";
import type { SelfContactIdentityView } from "../../../stores/contacts/currentSelfContactIdentityState";
import {
  CONTACTS_CONTAINER_NAME,
  deriveBuiltInSystemContainers,
} from "../../../stores/systemContainers";
import { getSelectedDocumentMutationState } from "../hooks/selectedDocumentMutationState";
import {
  canCreateStructuredDocumentInContainerByRules,
  canMoveDocumentToContainerByRules,
  canSaveDocumentCopyByRules,
  createExplorerContainerRulesContext,
  isPinnedSelfContact,
} from "./containerRules";
import {
  createAbsentSelfIdentity,
  createReadySelfIdentity,
  createSelfIdentityRules,
  identityDocument,
  selfIdentityNodes,
} from "./selfContactIdentity.testUtils";
import {
  createExplorerTargetLookups,
  getDocumentMoveTargetOptions,
} from "./targetOptions";

const destination = selfIdentityNodes.find(({ id }) => id === "destination");
const editableRuntime = {
  auth: { isAuthenticated: true },
  infra: { dbStatus: "ready" },
  state: { online: true },
} satisfies Parameters<typeof getSelectedDocumentMutationState>[0]["appData"];

test("canonical Me stays pinned before the Contacts slot is available", async () => {
  const identity = await createReadySelfIdentity();
  const rulesContext = createExplorerContainerRulesContext({
    contactsContainerId: null,
    contactsSystemSlot: null,
    currentOrganizationId: "identity-org",
    selfContactIdentity: identity,
    trashSystemSlot: null,
  });
  const document = identityDocument({
    id: identity.identity.localId,
    documentId: identity.identity.documentId,
    documentKind: "contact",
  });
  expect({
    pinned: isPinnedSelfContact(rulesContext, document),
    move: canMoveDocumentToContainerByRules(
      rulesContext,
      selfIdentityNodes.find(({ id }) => id === document.containerId),
      destination,
      document,
    ),
  }).toEqual({ pinned: true, move: false });
});

for (const containerId of ["linked-folder", "trash"]) {
  test(`canonical-D alias is pinned in ${containerId} despite false self fields`, async () => {
    const identity = await createReadySelfIdentity();
    const rulesContext = createSelfIdentityRules(identity);
    const document = {
      ...identityDocument({
        id: "discovered-me-alias",
        documentId: identity.identity.documentId,
        documentKind: "contact",
        containerId,
      }),
      isSelf: false,
      userId: "not-the-current-user",
    };
    // Prove this is a D match, not a fingerprint-local or enumerated-alias match.
    expect(identity.identity.localIds.has(document.id)).toBe(false);
    expect({
      pinned: isPinnedSelfContact(rulesContext, document),
      canMove: canMoveDocumentToContainerByRules(
        rulesContext,
        selfIdentityNodes.find(({ id }) => id === containerId),
        destination,
        document,
      ),
      targets: getDocumentMoveTargetOptions(
        selfIdentityNodes,
        document.id,
        createExplorerTargetLookups(selfIdentityNodes, [document]),
        rulesContext,
        new Map(),
      ),
    }).toEqual({ pinned: true, canMove: false, targets: [] });
  });
}

test("a distinct same-user roster is not pinned as Me", async () => {
  const identity = await createReadySelfIdentity();
  const roster = {
    ...identityDocument({
      id: "same-user-roster",
      documentId: await deriveStableDocumentId(
        getRosterProfileDocumentLocalId({
          organizationId: "identity-org",
          userId: "current-user",
        }),
      ),
      documentKind: "contact",
    }),
    isSelf: true,
    userId: "current-user",
  };
  const rulesContext = createSelfIdentityRules(identity);
  expect(roster.documentId).not.toBe(identity.identity.documentId);
  expect(identity.identity.localIds.has(roster.id)).toBe(false);
  expect({
    pinned: isPinnedSelfContact(rulesContext, roster),
    canMove: canMoveDocumentToContainerByRules(
      rulesContext,
      selfIdentityNodes.find(({ id }) => id === roster.containerId),
      destination,
      roster,
    ),
  }).toEqual({ pinned: false, canMove: true });
});

for (const status of ["pending", "failed", "expired"] as const) {
  test(`${status} self identity refuses an otherwise writable ordinary move`, async () => {
    const identity: SelfContactIdentityView =
      status === "expired"
        ? await createReadySelfIdentity(() => false)
        : status === "failed"
          ? { status: "failed", error: new Error("identity unavailable") }
          : { status: "pending" };
    const document = identityDocument();
    expect(
      canMoveDocumentToContainerByRules(
        createSelfIdentityRules(identity),
        selfIdentityNodes.find(({ id }) => id === document.containerId),
        destination,
        document,
      ),
    ).toBe(false);
  });
}

test("expired identity revokes destructive menu gates even with retained move targets", async () => {
  let current = true;
  const identity = await createReadySelfIdentity(() => current);
  const rulesContext = createSelfIdentityRules(identity);
  const document = identityDocument();
  const moveTargets = getDocumentMoveTargetOptions(
    selfIdentityNodes,
    document.id,
    createExplorerTargetLookups(selfIdentityNodes, [document]),
    rulesContext,
    new Map(),
  );
  expect(moveTargets.map(({ id }) => id)).toContain("destination");
  const input = {
    appData: editableRuntime,
    canResolveTrashContainer: true,
    nodes: selfIdentityNodes,
    rulesContext,
    selectedDocument: document,
    selectedDocumentLinkedContainerIds: ["linked-folder"],
    selectedDocumentLinkTargetOptions: [],
    selectedDocumentMoveTargetOptions: moveTargets,
    trashContainerId: "trash",
    trashSystemSlot: "trash-slot",
  };
  const before = getSelectedDocumentMutationState(input);
  expect(before.canMoveSelectedDocument).toBe(true);
  expect(before.canDeleteSelectedDocument).toBe(true);
  expect(
    getSelectedDocumentMutationState({
      ...input,
      selectedDocument: { ...document, containerId: "trash" },
    }).canPurgeSelectedDocument,
  ).toBe(true);

  current = false;
  const after = getSelectedDocumentMutationState(input);
  expect({
    move: after.canMoveSelectedDocument,
    delete: after.canDeleteSelectedDocument,
    purge: getSelectedDocumentMutationState({
      ...input,
      selectedDocument: { ...document, containerId: "trash" },
    }).canPurgeSelectedDocument,
  }).toEqual({ move: false, delete: false, purge: false });
});

for (const documentKind of ["note", "contact"] as const) {
  test(`absent self identity admits ${documentKind} move, delete and purge while current`, () => {
    let current = true;
    const rulesContext = createSelfIdentityRules(
      createAbsentSelfIdentity(() => current),
    );
    const document = identityDocument({ documentKind });
    const sourceContainer = selfIdentityNodes.find(
      ({ id }) => id === document.containerId,
    );
    const input = {
      appData: editableRuntime,
      canResolveTrashContainer: true,
      nodes: selfIdentityNodes,
      rulesContext,
      selectedDocument: document,
      selectedDocumentLinkedContainerIds: ["linked-folder"],
      selectedDocumentLinkTargetOptions: [],
      selectedDocumentMoveTargetOptions: getDocumentMoveTargetOptions(
        selfIdentityNodes,
        document.id,
        createExplorerTargetLookups(selfIdentityNodes, [document]),
        rulesContext,
        new Map(),
      ),
      trashContainerId: "trash",
      trashSystemSlot: "trash-slot",
    };
    const gates = () => {
      const state = getSelectedDocumentMutationState(input);
      return {
        pinned: isPinnedSelfContact(rulesContext, document),
        canMove: canMoveDocumentToContainerByRules(
          rulesContext,
          sourceContainer,
          destination,
          document,
        ),
        move: state.canMoveSelectedDocument,
        delete: state.canDeleteSelectedDocument,
        purge: getSelectedDocumentMutationState({
          ...input,
          selectedDocument: { ...document, containerId: "trash" },
        }).canPurgeSelectedDocument,
      };
    };
    expect(gates()).toEqual({
      pinned: false,
      canMove: true,
      move: true,
      delete: true,
      purge: true,
    });
    current = false;
    expect(gates()).toEqual({
      pinned: false,
      canMove: false,
      move: false,
      delete: false,
      purge: false,
    });
  });
}

// Saving a version as a copy: the folder must take a new document of the
// version's kind, and a contact version must not be Me.
function node(id: string, overrides: Partial<ContainerNode> = {}) {
  const found = selfIdentityNodes.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`no test container ${id}`);
  return { ...found, ...overrides };
}

const ordinary = identityDocument();

test("a version is copied into an ordinary writable folder, whatever its kind", async () => {
  const rules = createSelfIdentityRules(await createReadySelfIdentity());
  const folder = node("linked-folder");

  expect(canSaveDocumentCopyByRules(rules, folder, ordinary, "note")).toBe(
    true,
  );
  expect(canSaveDocumentCopyByRules(rules, folder, ordinary, "contact")).toBe(
    true,
  );
});

test("a version is not copied into a folder that cannot be written or is unknown", async () => {
  const rules = createSelfIdentityRules(await createReadySelfIdentity());

  expect(
    canSaveDocumentCopyByRules(
      rules,
      node("linked-folder", { effectiveAccessLevel: "read" }),
      ordinary,
      "note",
    ),
  ).toBe(false);
  // A document whose folder is not in the tree: its write access is unproven.
  expect(canSaveDocumentCopyByRules(rules, undefined, ordinary, "note")).toBe(
    false,
  );
});

test("a version is never copied into the Trash", async () => {
  const rules = createSelfIdentityRules(await createReadySelfIdentity());
  const trash = node("trash");

  expect(canSaveDocumentCopyByRules(rules, trash, ordinary, "note")).toBe(
    false,
  );
  expect(canSaveDocumentCopyByRules(rules, trash, ordinary, "contact")).toBe(
    false,
  );
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
      expect(canSaveDocumentCopyByRules(rules, container, ordinary, kind)).toBe(
        false,
      );
    }
  }
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

  expect(canSaveDocumentCopyByRules(rules, shared, ordinary, "contact")).toBe(
    false,
  );
  expect(canSaveDocumentCopyByRules(rules, shared, ordinary, "note")).toBe(
    false,
  );
});

test("Contacts takes a contact version and nothing else", async () => {
  const rules = createSelfIdentityRules(await createReadySelfIdentity());
  const contacts = node("contacts");

  expect(canSaveDocumentCopyByRules(rules, contacts, ordinary, "contact")).toBe(
    true,
  );
  // A contact's first stops can replay as a note; Contacts does not take one.
  expect(canSaveDocumentCopyByRules(rules, contacts, ordinary, "note")).toBe(
    false,
  );
  expect(
    canSaveDocumentCopyByRules(
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
      expect(
        canSaveDocumentCopyByRules(rules, container, document, "contact"),
      ).toBe(false);
    }
  }
  // A version of Me from before it was a contact holds none of Me's fields.
  expect(
    canSaveDocumentCopyByRules(rules, node("linked-folder"), me, "note"),
  ).toBe(true);
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
    expect(canSaveDocumentCopyByRules(rules, folder, ordinary, "contact")).toBe(
      false,
    );
    expect(canSaveDocumentCopyByRules(rules, folder, ordinary, "note")).toBe(
      true,
    );
  }
});

test("without a signing identity there is no Me to refuse", () => {
  const rules = createSelfIdentityRules(createAbsentSelfIdentity());

  expect(
    canSaveDocumentCopyByRules(rules, node("contacts"), ordinary, "contact"),
  ).toBe(true);
});
