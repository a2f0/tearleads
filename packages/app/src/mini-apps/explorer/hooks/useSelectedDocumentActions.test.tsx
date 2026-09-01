import { afterEach, expect, test } from "bun:test";
import type {
  ContainerDocumentLinks,
  ContainerNode,
  DocumentSummary,
  MoveDocumentToContainerInput,
} from "@tearleads/client-sdk";
import { syncedContainerDocumentObjectSyncState } from "@tearleads/client-sdk";
import { cleanup, renderHook } from "@testing-library/react";
import { createExplorerContainerRulesContext } from "../model/containerRules";
import { useSelectedDocumentActions } from "./useSelectedDocumentActions";

afterEach(() => cleanup());

const CONTACTS_SLOT = "contacts-slot";
const TRASH_SLOT = "trash-slot";
const CONTACTS_CONTAINER_ID = "contacts-container";
const TRASH_CONTAINER_ID = "trash-container";

const rulesContext = createExplorerContainerRulesContext({
  contactsContainerId: CONTACTS_CONTAINER_ID,
  contactsSystemSlot: CONTACTS_SLOT,
  currentOrganizationId: null,
  currentSigningFingerprint: "fingerprint",
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

function renderActions(params: {
  documentSummaries: ReadonlyArray<DocumentSummary>;
  linkedContainerIdsByDocumentId?: ReadonlyMap<string, ReadonlyArray<string>>;
  loadOrphanedDocumentSummary?: (
    localId: string,
  ) => Promise<DocumentSummary | null>;
  moves: Array<MoveDocumentToContainerInput>;
}) {
  const { documentSummaries, moves } = params;
  const linkedContainerIdsByDocumentId =
    params.linkedContainerIdsByDocumentId ??
    new Map(
      documentSummaries.flatMap((document) =>
        document.documentId === null ? [] : [[document.documentId, []]],
      ),
    );
  const appData = {
    canMutateDocumentLinks: true,
    canMutateUnsyncedDocumentLinks: true,
    infra: { dbStatus: "ready" },
    moveDocumentToContainer: async (input: MoveDocumentToContainerInput) => {
      moves.push(input);
      return {
        linksChanged: false,
        note: { ...input.note, containerId: input.targetContainerId },
      };
    },
  } as unknown as ContainerDocumentLinks;

  return renderHook(() =>
    useSelectedDocumentActions({
      appData,
      documentSummaries,
      expandNode: () => undefined,
      linkedContainerIdsByDocumentId,
      loadDocumentSummary: async (localId) =>
        documentSummaries.find((document) => document.id === localId) ?? null,
      loadOrphanedDocumentSummary:
        params.loadOrphanedDocumentSummary ??
        (async (localId) =>
          documentSummaries.find((document) => document.id === localId) ??
          null),
      mergeDocumentSummary: () => undefined,
      nodes,
      onDocumentLinksChanged: () => undefined,
      rulesContext,
      setLinkedContainerIdsForDocument: () => undefined,
    }),
  );
}

test("move action allows custom contacts from contacts to trash only", async () => {
  const contactDocument: DocumentSummary = {
    containerId: CONTACTS_CONTAINER_ID,
    documentId: "contact-document",
    documentKind: "contact",
    id: "local-contact-2",
    title: "Ada Lovelace",
    updatedAt: "2026-06-01T00:00:00.000Z",
  };
  const moves: Array<MoveDocumentToContainerInput> = [];
  const view = renderActions({
    documentSummaries: [contactDocument],
    moves,
  });

  await expect(
    view.result.current.moveDocument(contactDocument.id, "user-container"),
  ).resolves.toBeNull();
  await expect(
    view.result.current.moveDocument(contactDocument.id, TRASH_CONTAINER_ID, {
      replaceLinkedContainers: true,
      sourceContainerId: CONTACTS_CONTAINER_ID,
    }),
  ).resolves.toEqual(
    expect.objectContaining({ containerId: TRASH_CONTAINER_ID }),
  );

  expect(moves).toEqual([
    expect.objectContaining({
      replaceLinkedContainers: true,
      sourceContainerId: CONTACTS_CONTAINER_ID,
      targetContainerId: TRASH_CONTAINER_ID,
    }),
  ]);
});

test("move action allows documents without a source container", async () => {
  const document: DocumentSummary = {
    containerId: null,
    documentId: "orphan-document",
    documentKind: "note",
    id: "orphan-local-document",
    title: "Detached document",
    updatedAt: "2026-06-01T00:00:00.000Z",
  };
  const moves: Array<MoveDocumentToContainerInput> = [];
  const view = renderActions({
    documentSummaries: [document],
    moves,
  });

  await expect(
    view.result.current.moveDocument(document.id, "user-container"),
  ).resolves.toEqual(
    expect.objectContaining({ containerId: "user-container" }),
  );

  expect(moves).toEqual([
    expect.objectContaining({
      targetContainerId: "user-container",
    }),
  ]);
});

test("move action rejects a null-container document with surviving links", async () => {
  const document: DocumentSummary = {
    containerId: null,
    documentId: "linked-document",
    documentKind: "note",
    id: "linked-local-document",
    title: "Linked document",
    updatedAt: "2026-06-01T00:00:00.000Z",
  };
  const moves: Array<MoveDocumentToContainerInput> = [];
  const view = renderActions({
    documentSummaries: [document],
    linkedContainerIdsByDocumentId: new Map([
      ["linked-document", ["surviving-container"]],
    ]),
    moves,
  });

  await expect(
    view.result.current.moveDocument(document.id, "user-container"),
  ).resolves.toBeNull();
  expect(moves).toEqual([]);
});

test("move action rejects an orphan outside the active organization scope", async () => {
  const document: DocumentSummary = {
    containerId: null,
    documentId: "foreign-document",
    documentKind: "note",
    id: "foreign-local-document",
    title: "Foreign document",
    updatedAt: "2026-06-01T00:00:00.000Z",
  };
  const moves: Array<MoveDocumentToContainerInput> = [];
  const view = renderActions({
    documentSummaries: [document],
    loadOrphanedDocumentSummary: async () => null,
    moves,
  });

  await expect(
    view.result.current.moveDocument(document.id, "user-container"),
  ).resolves.toBeNull();
  expect(moves).toEqual([]);
});
