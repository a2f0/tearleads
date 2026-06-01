import { expect, test } from "bun:test";
import type { DocumentSummary } from "@tearleads/client-sdk";
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

function getMutationState(
  overrides: Partial<
    Parameters<typeof getSelectedDocumentMutationState>[0]
  > = {},
) {
  return getSelectedDocumentMutationState({
    appData: editableRuntime,
    canResolveTrashContainer: true,
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
