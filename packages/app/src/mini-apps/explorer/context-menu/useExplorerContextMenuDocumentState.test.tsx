import { expect, test } from "bun:test";
import {
  type ContainerDocumentQueries,
  type ContainerNode,
  type DocumentSummary,
  syncedContainerDocumentObjectSyncState,
} from "@tearleads/client-sdk";
import { deriveOrganizationTrashSystemSlot } from "@tearleads/validators/containerSystemSlot";
import { renderHook, waitFor } from "@testing-library/react";
import type { RuntimeSnapshot } from "../../../providers/sdk/TearleadsProvider";
import { useExplorerContextMenuDocumentState } from "../hooks/useExplorerContextMenuDocumentState";
import { createCanonicalSelfContactIdentity } from "../model/canonicalSelfContact.testUtils";
import { createExplorerContainerRulesContext } from "../model/containerRules";

test("a linked row uses the clicked folder's permissions and Trash state in a shared organization", async () => {
  const org = "shared-org";
  const trashSlot = deriveOrganizationTrashSystemSlot(org);
  const row: DocumentSummary = {
    id: "local-note",
    documentId: "note",
    containerId: "trash",
    title: "Shared note",
    updatedAt: "2026-11-19T00:00:00Z",
  };
  const folder: ContainerNode = {
    id: "folder",
    name: "Folder",
    kind: "container",
    parentId: "root",
    organizationId: org,
    effectiveAccessLevel: "write",
    syncState: syncedContainerDocumentObjectSyncState,
  };
  const nodes = [
    folder,
    { ...folder, id: "trash", systemSlot: trashSlot },
    { ...folder, id: "read-only", effectiveAccessLevel: "read" as const },
  ];
  const queried: string[] = [];
  const queries = {
    async loadContainerDocumentSummary({
      containerId,
      documentId,
    }: {
      containerId: string;
      documentId: string;
    }) {
      expect(documentId).toBe("note");
      queried.push(containerId);
      return { ...row, containerId };
    },
  } as unknown as ContainerDocumentQueries;
  const params = {
    appData: {
      auth: { isAuthenticated: true },
      infra: { dbStatus: "ready" },
      state: { online: true },
      util: { logError: () => {} },
    } as unknown as RuntimeSnapshot,
    canResolveTrashContainer: true,
    documentListRevision: 1,
    documentQueries: queries,
    documentSummaries: [row],
    mergeDocumentSummary: () => {
      throw new Error("A secondary placement must not replace the cached home");
    },
    linkedContainerIdsByDocumentId: new Map([
      ["note", ["folder", "trash", "read-only"]],
    ]),
    nodes,
    rulesContext: createExplorerContainerRulesContext({
      contactsContainerId: null,
      contactsSystemSlot: null,
      currentOrganizationId: "viewer-org",
      selfContactIdentity: await createCanonicalSelfContactIdentity("viewer"),
      trashSystemSlot: deriveOrganizationTrashSystemSlot("viewer-org"),
    }),
    trashContainerId: null,
    trashSystemSlot: deriveOrganizationTrashSystemSlot("viewer-org"),
  };
  const menu = (containerId: string) => ({
    id: { kind: "document" as const, containerId, localId: row.id },
    position: { x: 0, y: 0 },
  });
  const view = renderHook(
    (contextMenu: ReturnType<typeof menu>) =>
      useExplorerContextMenuDocumentState({ ...params, contextMenu }),
    { initialProps: menu("folder") },
  );
  await waitFor(() =>
    expect(view.result.current.canDeleteContextMenuDocument).toBe(true),
  );
  expect(view.result.current.canPurgeContextMenuDocument).toBe(false);
  view.rerender(menu("read-only"));
  await waitFor(() => expect(queried).toContain("read-only"));
  expect(view.result.current.canDeleteContextMenuDocument).toBe(false);
  expect(view.result.current.canPurgeContextMenuDocument).toBe(false);
  view.rerender(menu("trash"));
  await waitFor(() =>
    expect(view.result.current.canPurgeContextMenuDocument).toBe(true),
  );
  expect(view.result.current.canDeleteContextMenuDocument).toBe(false);
  view.unmount();
});
