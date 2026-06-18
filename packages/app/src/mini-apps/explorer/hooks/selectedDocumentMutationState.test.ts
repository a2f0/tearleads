import { expect, test } from "bun:test";
import type { DocumentSummary } from "@tearleads/client-sdk";
import { createExplorerContainerRulesContext } from "../containerRules";
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
