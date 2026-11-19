import { afterEach, expect, test } from "bun:test";
import {
  type DocumentSummary,
  syncedContainerDocumentObjectSyncState,
} from "@tearleads/client-sdk";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { useExplorerContextMenuDocumentState } from "../hooks/useExplorerContextMenuDocumentState";
import { createExplorerContainerRulesContext } from "../model/containerRules";

afterEach(cleanup);

const contact: DocumentSummary = {
  id: "local-contact",
  documentId: null,
  documentKind: "contact",
  containerId: "contacts",
  title: "Ada",
  updatedAt: "",
};
const root = {
  id: "root",
  kind: "container",
  name: "/",
  organizationId: "org",
  parentId: null,
  syncState: syncedContainerDocumentObjectSyncState,
} as const;

function menuInput(
  summary: DocumentSummary,
  containerId = "contacts",
  trashResolved = true,
) {
  const trashSystemSlot = trashResolved ? "trash-slot" : null;
  const loadDocumentSummary = async () => summary;
  return {
    appData: {
      auth: { isAuthenticated: true },
      state: { online: true },
      infra: { dbStatus: "ready" as const },
    },
    contextMenu: {
      id: { kind: "document" as const, localId: summary.id, containerId },
      position: { x: 0, y: 0 },
    },
    canResolveTrashContainer: trashResolved,
    trashContainerId: "trash",
    trashSystemSlot,
    documentSummaries: [summary],
    linkedContainerIdsByDocumentId: new Map<string, string[]>(),
    nodes: [
      root,
      { ...root, id: "contacts", parentId: root.id, name: "Contacts" },
      {
        ...root,
        id: "trash",
        parentId: root.id,
        name: "Trash",
        systemSlot: "trash-slot",
      },
    ],
    rulesContext: createExplorerContainerRulesContext({
      contactsContainerId: "contacts",
      contactsSystemSlot: null,
      currentOrganizationId: "org",
      selfContactIdentity: { status: "pending" },
      trashSystemSlot,
    }),
    documentQueries: {
      loadDocumentSummary,
      loadContainerDocumentSummary: async () => null,
      loadOrphanedDocumentSummary: async () => null,
    },
    documentListRevision: 0,
  };
}

test.each([
  ["writable contact", contact, "contacts", true, true],
  [
    "read-only contact",
    { ...contact, effectiveAccessLevel: "read" },
    "contacts",
    true,
    false,
  ],
  [
    "another document type",
    { ...contact, documentKind: "note" },
    "contacts",
    true,
    false,
  ],
  ["Trash", contact, "trash", true, false],
  ["unresolved Trash slot", contact, "trash", false, false],
] as const)(
  "contact Edit availability for %s",
  async (_, summary, container, resolved, expected) => {
    const input = menuInput(summary, container, resolved);
    const { result } = renderHook(() =>
      useExplorerContextMenuDocumentState(input),
    );
    await act(async () => {});
    expect(result.current.canEditContextMenuContact).toBe(expected);
  },
);

test("a late menu lookup cannot enable Edit for the same local ID in another scope", async () => {
  const oldScope = Promise.withResolvers<DocumentSummary | null>();
  const readOnly = { ...contact, effectiveAccessLevel: "read" as const };
  const input = { ...menuInput(contact), documentSummaries: [] };
  const initialProps = {
    ...input,
    documentQueries: {
      ...input.documentQueries,
      loadDocumentSummary: () => oldScope.promise,
    },
  };
  const { result, rerender } = renderHook(useExplorerContextMenuDocumentState, {
    initialProps,
  });
  const nextScope = menuInput(readOnly);
  rerender({ ...initialProps, documentQueries: nextScope.documentQueries });
  await act(async () => oldScope.resolve(contact));
  expect(result.current.canEditContextMenuContact).toBe(false);
  const writable = menuInput(contact);
  rerender({ ...initialProps, documentQueries: writable.documentQueries });
  await waitFor(() =>
    expect(result.current.canEditContextMenuContact).toBe(true),
  );
});
