import { afterEach, expect, test } from "bun:test";
import type { ContainerNode, DocumentSummary } from "@symcrypt/client-sdk";
import { syncedContainerDocumentObjectSyncState } from "@symcrypt/client-sdk";
import { act, cleanup, renderHook } from "@testing-library/react";
import { createExplorerContainerRulesContext } from "../model/containerRules";
import { useExplorerModalController } from "./controller";

afterEach(() => cleanup());

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
  containerNode({ id: "user-container", name: "Documents" }),
];

function documentSummary(
  overrides: Partial<DocumentSummary> & Pick<DocumentSummary, "id">,
): DocumentSummary {
  return {
    containerId: TRASH_CONTAINER_ID,
    documentId: "document-1",
    documentKind: "note",
    title: "Document",
    updatedAt: "2026-06-01T00:00:00.000Z",
    ...overrides,
  };
}

function renderController(documentSummaries: ReadonlyArray<DocumentSummary>) {
  return renderHook(() =>
    useExplorerModalController({
      createChild: async () => null,
      documentSummaries,
      expandNode: () => undefined,
      linkDocument: async () => null,
      canShareWithPeer: true,
      linkedContainerIdsByDocumentId: new Map(),
      moveContainer: async () => null,
      moveDocument: async () => null,
      nodes,
      online: true,
      peerUserId: null,
      startContainerPurge: () => undefined,
      startEmptyTrash: () => undefined,
      renameContainer: async () => null,
      rulesContext,
      setSelectedId: () => undefined,
      shareWithUser: async () => false,
    }),
  );
}

test("move document modal filters contacts out for non-contact documents", () => {
  const trashedNote = documentSummary({ id: "trashed-note" });
  const view = renderController([trashedNote]);

  act(() => {
    view.result.current.openMoveDocumentModal(trashedNote.id);
  });

  expect(view.result.current.modalState).toEqual({
    mode: "move-document",
    documentLocalId: trashedNote.id,
  });
  expect(
    view.result.current.moveTargetOptions.map((option) => option.id),
  ).not.toContain(CONTACTS_CONTAINER_ID);
});

test("move document modal includes contacts for contact documents", () => {
  const trashedContact = documentSummary({
    id: "trashed-contact",
    documentKind: "contact",
  });
  const view = renderController([trashedContact]);

  act(() => {
    view.result.current.openMoveDocumentModal(trashedContact.id);
  });

  expect(
    view.result.current.moveTargetOptions.map((option) => option.id),
  ).toContain(CONTACTS_CONTAINER_ID);
});
