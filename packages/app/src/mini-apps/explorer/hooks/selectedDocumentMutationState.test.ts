import { expect, test } from "bun:test";
import type { ContainerNode, DocumentSummary } from "@symcrypt/client-sdk";
import { syncedContainerDocumentObjectSyncState } from "@symcrypt/client-sdk";
import { createExplorerContainerRulesContext } from "../model/containerRules";
import {
  createExplorerTargetLookups,
  getDocumentLinkTargetOptions,
  getDocumentMoveTargetOptions,
} from "../model/targetOptions";
import { getSelectedDocumentMutationState } from "./selectedDocumentMutationState";

const editableRuntime = {
  auth: { isAuthenticated: true },
  infra: { dbStatus: "ready" },
  state: { online: true },
} satisfies Parameters<typeof getSelectedDocumentMutationState>[0]["appData"];

const deviceFirstRuntime = {
  auth: { isAuthenticated: false },
  infra: { dbStatus: "ready" },
  state: { online: false },
} satisfies Parameters<typeof getSelectedDocumentMutationState>[0]["appData"];

const selectedDocument: DocumentSummary = {
  containerId: "source-container",
  documentId: "document-1",
  id: "local-document-1",
  title: "Document",
  updatedAt: "2026-06-01T00:00:00.000Z",
};

const rulesContext = createExplorerContainerRulesContext({
  contactsContainerId: "contacts-container",
  contactsSystemSlot: "contacts-slot",
  currentOrganizationId: null,
  // The viewer's self-contact id derives from this fingerprint, so
  // "self_contact_v1_fingerprint" is the viewer's own "You" contact.
  currentSigningFingerprint: "fingerprint",
  trashSystemSlot: "trash-slot",
});

// Default node tree used by the purge/delete gate tests. The gate resolves
// "is this container under trash" by walking parentId, so a "trash" root and a
// "trash-subfolder" nested under it must exist as nodes for the equality-free
// gate to evaluate. `source-container` stays outside trash.
const gateNodes: ReadonlyArray<ContainerNode> = [
  {
    id: "root",
    kind: "container",
    name: "/",
    organizationId: "org-1",
    parentId: null,
    syncState: syncedContainerDocumentObjectSyncState,
  },
  {
    id: "trash",
    kind: "container",
    name: "Trash",
    organizationId: "org-1",
    parentId: "root",
    systemSlot: "trash-slot",
    syncState: syncedContainerDocumentObjectSyncState,
  },
  {
    id: "trash-subfolder",
    kind: "container",
    name: "Subfolder",
    organizationId: "org-1",
    parentId: "trash",
    syncState: syncedContainerDocumentObjectSyncState,
  },
  {
    id: "source-container",
    kind: "container",
    name: "Source",
    organizationId: "org-1",
    parentId: "root",
    syncState: syncedContainerDocumentObjectSyncState,
  },
  {
    id: "contacts-container",
    kind: "container",
    name: "Contacts",
    organizationId: "org-1",
    parentId: "root",
    systemSlot: "contacts-slot",
    syncState: syncedContainerDocumentObjectSyncState,
  },
];

function getMutationState(
  overrides: Partial<
    Parameters<typeof getSelectedDocumentMutationState>[0]
  > = {},
) {
  return getSelectedDocumentMutationState({
    appData: editableRuntime,
    canResolveTrashContainer: true,
    nodes: gateNodes,
    rulesContext,
    selectedDocument,
    selectedDocumentLinkedContainerIds: ["source-container"],
    selectedDocumentLinkTargetOptions: [],
    selectedDocumentMoveTargetOptions: [],
    trashContainerId: null,
    trashSystemSlot: "trash-slot",
    ...overrides,
  });
}

test("document delete can lazy-create the trash container", () => {
  expect(getMutationState().canDeleteSelectedDocument).toBe(true);
});

test("document delete is enabled for local documents before authentication", () => {
  expect(
    getMutationState({
      appData: deviceFirstRuntime,
      selectedDocument: { ...selectedDocument, documentId: null },
    }).canDeleteSelectedDocument,
  ).toBe(true);
});

test("document delete is enabled for remote documents before authentication", () => {
  expect(
    getMutationState({ appData: deviceFirstRuntime }).canDeleteSelectedDocument,
  ).toBe(true);
});

test("document delete waits until trash can be resolved", () => {
  expect(
    getMutationState({ canResolveTrashContainer: false })
      .canDeleteSelectedDocument,
  ).toBe(false);
});

test("document delete is disabled for documents already in trash", () => {
  expect(
    getMutationState({
      selectedDocument: { ...selectedDocument, containerId: "trash" },
      trashContainerId: "trash",
    }).canDeleteSelectedDocument,
  ).toBe(false);
});

test("document delete is disabled for the self contact in the contacts container", () => {
  expect(
    getMutationState({
      selectedDocument: {
        ...selectedDocument,
        containerId: "contacts-container",
        id: "self_contact_v1_fingerprint",
      },
    }).canDeleteSelectedDocument,
  ).toBe(false);
});

test("document delete is disabled for the self contact linked into another container", () => {
  // Linking the self contact into a user container surfaces it there with that
  // container's id, but it must stay undeletable so only unlink is offered.
  expect(
    getMutationState({
      selectedDocument: {
        ...selectedDocument,
        containerId: "source-container",
        id: "self_contact_v1_fingerprint",
      },
      selectedDocumentLinkedContainerIds: [
        "contacts-container",
        "source-container",
      ],
    }).canDeleteSelectedDocument,
  ).toBe(false);
});

test("document delete stays enabled for non-self contacts in the contacts container", () => {
  expect(
    getMutationState({
      selectedDocument: {
        ...selectedDocument,
        containerId: "contacts-container",
        id: "local-contact-2",
      },
    }).canDeleteSelectedDocument,
  ).toBe(true);
});

test("document purge is enabled for documents already in trash", () => {
  expect(
    getMutationState({
      selectedDocument: { ...selectedDocument, containerId: "trash" },
      trashContainerId: "trash",
    }).canPurgeSelectedDocument,
  ).toBe(true);
});

test("document purge is disabled for the self contact even when under trash", () => {
  // Defense in depth: a self contact that somehow reached Trash must not be
  // purgeable, since purge destroys the document server-side by id.
  expect(
    getMutationState({
      selectedDocument: {
        ...selectedDocument,
        containerId: "trash",
        id: "self_contact_v1_fingerprint",
      },
      trashContainerId: "trash",
    }).canPurgeSelectedDocument,
  ).toBe(false);
});

test("document purge is disabled for documents outside trash", () => {
  expect(
    getMutationState({ trashContainerId: "trash" }).canPurgeSelectedDocument,
  ).toBe(false);
});

test("document purge is enabled for documents in a subfolder of trash", () => {
  // Regression: the gate used to require containerId === trashContainerId
  // (the trash root). A document parked in a user-created subfolder of trash
  // must still be purgeable.
  expect(
    getMutationState({
      selectedDocument: {
        ...selectedDocument,
        containerId: "trash-subfolder",
      },
      trashContainerId: "trash",
    }).canPurgeSelectedDocument,
  ).toBe(true);
});

test("document purge stays disabled for a document in a non-trash subtree", () => {
  expect(
    getMutationState({
      selectedDocument: {
        ...selectedDocument,
        containerId: "source-container",
      },
      trashContainerId: "trash",
    }).canPurgeSelectedDocument,
  ).toBe(false);
});

test("document purge is disabled when delete is enabled (inverse trash gate)", () => {
  const state = getMutationState();
  expect(state.canDeleteSelectedDocument).toBe(true);
  expect(state.canPurgeSelectedDocument).toBe(false);
});

test("document purge is enabled for unsynced documents in trash before authentication", () => {
  expect(
    getMutationState({
      appData: deviceFirstRuntime,
      selectedDocument: {
        ...selectedDocument,
        containerId: "trash",
        documentId: null,
      },
      trashContainerId: "trash",
    }).canPurgeSelectedDocument,
  ).toBe(true);
});

test("document purge is disabled for synced documents in trash before authentication", () => {
  expect(
    getMutationState({
      appData: deviceFirstRuntime,
      selectedDocument: { ...selectedDocument, containerId: "trash" },
      trashContainerId: "trash",
    }).canPurgeSelectedDocument,
  ).toBe(false);
});

test("document purge waits until trash can be resolved", () => {
  expect(
    getMutationState({
      canResolveTrashContainer: false,
      selectedDocument: { ...selectedDocument, containerId: "trash" },
      trashContainerId: "trash",
    }).canPurgeSelectedDocument,
  ).toBe(false);
});

// End-to-end reproduction of the user-facing "move out of trash" flow: wire the
// real move-target computation (getDocumentMoveTargetOptions) into the real menu
// gate (getSelectedDocumentMutationState), exactly as useExplorerModel composes
// them, for a document whose home container is the Trash system container.
const TRASH_SLOT = "trash-slot";
const TRASH_CONTAINER_ID = "trash-container";

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

const trashFlowNodes: ReadonlyArray<ContainerNode> = [
  containerNode({ id: "root-container", name: "/", parentId: null }),
  containerNode({
    id: TRASH_CONTAINER_ID,
    name: "Trash",
    systemSlot: TRASH_SLOT,
  }),
  containerNode({ id: "documents-container", name: "Documents" }),
];

function trashFlowMoveTargets(trashedDocument: DocumentSummary) {
  return getDocumentMoveTargetOptions(
    trashFlowNodes,
    trashedDocument.id,
    createExplorerTargetLookups(trashFlowNodes, [trashedDocument]),
    rulesContext,
    new Map(),
  );
}

function moveOutOfTrashState(trashedDocument: DocumentSummary) {
  const linkTargetOptions = getDocumentLinkTargetOptions(
    trashFlowNodes,
    trashedDocument.id,
    [TRASH_CONTAINER_ID],
    createExplorerTargetLookups(trashFlowNodes, [trashedDocument]),
    rulesContext,
  );
  const moveTargetOptions = trashFlowMoveTargets(trashedDocument);
  return {
    linkTargetOptions,
    moveTargetOptions,
    mutationState: getMutationState({
      nodes: trashFlowNodes,
      selectedDocument: trashedDocument,
      selectedDocumentLinkTargetOptions: linkTargetOptions,
      selectedDocumentMoveTargetOptions: moveTargetOptions,
      trashContainerId: TRASH_CONTAINER_ID,
    }),
  };
}

test("a synced document in trash can be moved out (Move enabled, targets offered)", () => {
  const trashedDocument: DocumentSummary = {
    ...selectedDocument,
    containerId: TRASH_CONTAINER_ID,
  };
  const { moveTargetOptions, mutationState } =
    moveOutOfTrashState(trashedDocument);

  // The Trash bin itself is never a self-target, but every other container is a
  // valid restore destination.
  const optionIds = moveTargetOptions.map((option) => option.id);
  expect(optionIds).not.toContain(TRASH_CONTAINER_ID);
  expect(optionIds).toContain("documents-container");
  expect(optionIds).toContain("root-container");

  // The menu gate the UI actually reads must enable Move.
  expect(mutationState.canMoveSelectedDocument).toBe(true);
});

test("a synced document in trash cannot be linked from toolbar or context-menu state", () => {
  const trashedDocument: DocumentSummary = {
    ...selectedDocument,
    containerId: TRASH_CONTAINER_ID,
  };
  const { linkTargetOptions, mutationState } =
    moveOutOfTrashState(trashedDocument);

  expect(linkTargetOptions).toEqual([]);
  expect(mutationState.canLinkSelectedDocument).toBe(false);
  expect(mutationState.canMoveSelectedDocument).toBe(true);
});

test("moving out of trash is independent of the purge/delete trash gates", () => {
  const trashedDocument: DocumentSummary = {
    ...selectedDocument,
    containerId: TRASH_CONTAINER_ID,
  };
  const { mutationState } = moveOutOfTrashState(trashedDocument);

  // While in trash: Move out is allowed, permanent purge is allowed, and the
  // (redundant) re-delete-to-trash is correctly disabled.
  expect(mutationState.canMoveSelectedDocument).toBe(true);
  expect(mutationState.canPurgeSelectedDocument).toBe(true);
  expect(mutationState.canDeleteSelectedDocument).toBe(false);
});

test("a last-link orphan can move into its organization's writable containers", () => {
  const orphanedDocument: DocumentSummary = {
    ...selectedDocument,
    containerId: null,
  };
  const moveTargetOptions = getDocumentMoveTargetOptions(
    gateNodes,
    orphanedDocument.id,
    createExplorerTargetLookups(gateNodes, [orphanedDocument]),
    { ...rulesContext, currentOrganizationId: "org-1" },
    new Map([[orphanedDocument.documentId ?? "", []]]),
  );

  expect(moveTargetOptions.map(({ id }) => id)).toContain("source-container");
  const mutationState = getMutationState({
    selectedDocument: orphanedDocument,
    selectedDocumentMoveTargetOptions: moveTargetOptions,
  });
  expect(mutationState.canMoveSelectedDocument).toBe(true);
  expect(mutationState.canDeleteSelectedDocument).toBe(false);
  expect(mutationState.canPurgeSelectedDocument).toBe(false);
});

// The two conditions that DO disable "move out of trash" — documenting the
// real-world ways a user hits a greyed-out Move on a trashed item.

test("move out of trash is enabled while offline / unauthenticated", () => {
  const trashedDocument: DocumentSummary = {
    ...selectedDocument,
    containerId: TRASH_CONTAINER_ID,
  };
  const moveTargetOptions = trashFlowMoveTargets(trashedDocument);
  expect(moveTargetOptions.length).toBeGreaterThan(0);
  expect(
    getMutationState({
      appData: deviceFirstRuntime,
      nodes: trashFlowNodes,
      selectedDocument: trashedDocument,
      selectedDocumentMoveTargetOptions: moveTargetOptions,
      trashContainerId: TRASH_CONTAINER_ID,
    }).canMoveSelectedDocument,
  ).toBe(true);
});

test("move out of trash is disabled when the trash node is absent from the tree", () => {
  // If the trashed document's containerId does not resolve to a node in the
  // visible tree, getDocumentMoveTargetOptions yields no destinations and Move
  // is disabled. This is the failure shape to watch for (e.g. a stale/unresolved
  // trash container), distinct from any permission rule.
  const trashedDocument: DocumentSummary = {
    ...selectedDocument,
    containerId: "unresolved-trash-container",
  };
  const moveTargetOptions = trashFlowMoveTargets(trashedDocument);
  expect(moveTargetOptions).toEqual([]);
  expect(
    getMutationState({
      nodes: trashFlowNodes,
      selectedDocument: trashedDocument,
      selectedDocumentMoveTargetOptions: moveTargetOptions,
      trashContainerId: TRASH_CONTAINER_ID,
    }).canMoveSelectedDocument,
  ).toBe(false);
});

// Gate values for a brand-new, never-synced note. These drive toolbar/context
// visibility: the surfaces hide an action when its gate is false rather than
// showing it greyed. Link is fundamentally remote (addDocumentLink no-ops
// without a documentId), so it stays unavailable until first sync; Move only
// relocates the local containerId, so it stays available offline / pre-sync.
const linkAndMoveTargets = [{ id: "root", icon: null, label: "/" }];

test("a new unsynced note: Link unavailable, Move available", () => {
  const state = getMutationState({
    selectedDocument: { ...selectedDocument, documentId: null },
    selectedDocumentLinkTargetOptions: linkAndMoveTargets,
    selectedDocumentMoveTargetOptions: linkAndMoveTargets,
  });
  expect(state.canLinkSelectedDocument).toBe(false);
  expect(state.canMoveSelectedDocument).toBe(true);
});

test("a synced note: both Link and Move available", () => {
  const state = getMutationState({
    selectedDocumentLinkTargetOptions: linkAndMoveTargets,
    selectedDocumentMoveTargetOptions: linkAndMoveTargets,
  });
  expect(state.canLinkSelectedDocument).toBe(true);
  expect(state.canMoveSelectedDocument).toBe(true);
});

test("delete and move stay available on a never-synced note", () => {
  const state = getMutationState({
    selectedDocument: { ...selectedDocument, documentId: null },
    selectedDocumentMoveTargetOptions: linkAndMoveTargets,
  });
  expect(state.canMoveSelectedDocument).toBe(true);
  expect(state.canDeleteSelectedDocument).toBe(true);
});
