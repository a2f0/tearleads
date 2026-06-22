import { expect, test } from "bun:test";
import type { ContainerNode, DocumentSummary } from "@tearleads/client-sdk";
import { syncedContainerDocumentObjectSyncState } from "@tearleads/client-sdk";
import { createExplorerContainerRulesContext } from "../containerRules";
import { getDocumentMoveTargetOptions } from "../targetOptions";
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
  trashSystemSlot: "trash-slot",
});

function getMutationState(
  overrides: Partial<
    Parameters<typeof getSelectedDocumentMutationState>[0]
  > = {},
) {
  return getSelectedDocumentMutationState({
    appData: editableRuntime,
    canResolveTrashContainer: true,
    rulesContext,
    selectedDocument,
    selectedDocumentLinkedContainerIds: ["source-container"],
    selectedDocumentLinkTargetOptions: [],
    selectedDocumentMoveTargetOptions: [],
    trashContainerId: null,
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

test("document delete is disabled for remote documents before authentication", () => {
  expect(
    getMutationState({ appData: deviceFirstRuntime }).canDeleteSelectedDocument,
  ).toBe(false);
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

test("document purge is disabled for documents outside trash", () => {
  expect(
    getMutationState({ trashContainerId: "trash" }).canPurgeSelectedDocument,
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

function moveOutOfTrashState(trashedDocument: DocumentSummary) {
  const moveTargetOptions = getDocumentMoveTargetOptions(
    trashFlowNodes,
    [trashedDocument],
    trashedDocument.id,
    undefined,
    rulesContext,
  );
  return {
    moveTargetOptions,
    mutationState: getMutationState({
      selectedDocument: trashedDocument,
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

// The two conditions that DO disable "move out of trash" — documenting the
// real-world ways a user hits a greyed-out Move on a trashed item.

// KNOWN INCONSISTENCY (not desired behavior we want to lock in): a *synced*
// document move requires online + auth and has no offline-queue path, whereas a
// folder/container move queues a moveIntent offline and reconciles on reconnect
// (see moveContainer in client-sdk stores/container-contents/operations.ts) and
// deleting a never-synced document relinks locally. So moving a synced document
// out of trash silently fails offline even though the equivalent folder move
// would succeed. If synced document moves gain an offline queued-relink path to
// match containers, update this expectation to true.
test("move out of trash is disabled while offline / unauthenticated (unlike delete)", () => {
  const trashedDocument: DocumentSummary = {
    ...selectedDocument,
    containerId: TRASH_CONTAINER_ID,
  };
  const moveTargetOptions = getDocumentMoveTargetOptions(
    trashFlowNodes,
    [trashedDocument],
    trashedDocument.id,
    undefined,
    rulesContext,
  );
  // Targets still compute (rules permit leaving trash)...
  expect(moveTargetOptions.length).toBeGreaterThan(0);
  // ...but the mutate gate requires online + authenticated, so Move is off.
  expect(
    getMutationState({
      appData: deviceFirstRuntime,
      selectedDocument: trashedDocument,
      selectedDocumentMoveTargetOptions: moveTargetOptions,
      trashContainerId: TRASH_CONTAINER_ID,
    }).canMoveSelectedDocument,
  ).toBe(false);
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
  const moveTargetOptions = getDocumentMoveTargetOptions(
    trashFlowNodes,
    [trashedDocument],
    trashedDocument.id,
    undefined,
    rulesContext,
  );
  expect(moveTargetOptions).toEqual([]);
  expect(
    getMutationState({
      selectedDocument: trashedDocument,
      selectedDocumentMoveTargetOptions: moveTargetOptions,
      trashContainerId: TRASH_CONTAINER_ID,
    }).canMoveSelectedDocument,
  ).toBe(false);
});
