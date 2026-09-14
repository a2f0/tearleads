import { afterEach, expect, test } from "bun:test";
import type { ContainerNode, DocumentSummary } from "@tearleads/client-sdk";
import { syncedContainerDocumentObjectSyncState } from "@tearleads/client-sdk";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { FormEvent } from "react";
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

function renderController(
  documentSummaries: ReadonlyArray<DocumentSummary>,
  overrides: {
    createChild?: () => Promise<ContainerNode | null>;
    logError?: (message: string | Error, cause?: unknown) => void;
  } = {},
) {
  return renderHook(() =>
    useExplorerModalController({
      createChild: overrides.createChild ?? (async () => null),
      documentSummaries,
      expandNode: () => undefined,
      linkDocument: async () => null,
      logError: overrides.logError ?? (() => undefined),
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

function submitEvent(): FormEvent<HTMLFormElement> {
  return {
    preventDefault: () => undefined,
  } as unknown as FormEvent<HTMLFormElement>;
}

test("a thrown create reports the original error and keeps the modal error", async () => {
  const failure = new Error("create failed");
  const logged: Array<[string | Error, unknown]> = [];
  const view = renderController([], {
    createChild: async () => {
      throw failure;
    },
    logError: (message, cause) => {
      logged.push([message, cause]);
    },
  });

  act(() => {
    view.result.current.openCreateChildModal("user-container");
    view.result.current.setDraftName("Reports");
  });
  await act(async () => {
    await view.result.current.handleModalSubmit(submitEvent());
  });

  expect(logged).toEqual([[expect.any(String), failure]]);
  expect(view.result.current.modalError).toBe(
    "Failed to create child container.",
  );
});

test("a create lost to database teardown keeps the modal error but stays local", async () => {
  const logged: unknown[] = [];
  const view = renderController([], {
    createChild: async () => {
      throw new Error("Database worker client has been destroyed.");
    },
    logError: (_message, cause) => {
      logged.push(cause);
    },
  });

  act(() => {
    view.result.current.openCreateChildModal("user-container");
    view.result.current.setDraftName("Reports");
  });
  await act(async () => {
    await view.result.current.handleModalSubmit(submitEvent());
  });

  expect(logged).toEqual([]);
  expect(view.result.current.modalError).toBe(
    "Failed to create child container.",
  );
});
