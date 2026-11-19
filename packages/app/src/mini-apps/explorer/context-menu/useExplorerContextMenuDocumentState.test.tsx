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
    containerId: "read-only",
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
    { ...folder, id: "another-folder" },
    { ...folder, id: "trash", systemSlot: trashSlot },
    { ...folder, id: "read-only", effectiveAccessLevel: "read" as const },
  ];
  const queried: string[] = [];
  const queries = {
    loadDocumentSummary: async () => row,
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
  const folderMenu = menu("folder");
  const view = renderHook(
    ({
      contextMenu,
      nodes,
    }: {
      contextMenu: ReturnType<typeof menu>;
      nodes: readonly ContainerNode[];
    }) =>
      useExplorerContextMenuDocumentState({ ...params, contextMenu, nodes }),
    { initialProps: { contextMenu: folderMenu, nodes } },
  );
  await waitFor(() =>
    expect(view.result.current.canDeleteContextMenuDocument).toBe(true),
  );
  expect(view.result.current.canPurgeContextMenuDocument).toBe(false);
  expect(view.result.current.canMoveContextMenuDocument).toBe(false);
  expect(view.result.current.canLinkContextMenuDocument).toBe(false);
  for (const targetNodes of [
    nodes.filter((node) => node.id !== "trash"),
    nodes.map((node) =>
      node.id === "trash"
        ? { ...node, effectiveAccessLevel: "read" as const }
        : node,
    ),
  ]) {
    view.rerender({ contextMenu: folderMenu, nodes: targetNodes });
    await waitFor(() =>
      expect(view.result.current.canDeleteContextMenuDocument).toBe(false),
    );
  }
  view.rerender({ contextMenu: menu("read-only"), nodes });
  await waitFor(() => expect(queried).toContain("read-only"));
  expect(view.result.current.canDeleteContextMenuDocument).toBe(false);
  expect(view.result.current.canPurgeContextMenuDocument).toBe(false);
  view.rerender({ contextMenu: menu("trash"), nodes });
  await waitFor(() =>
    expect(view.result.current.canPurgeContextMenuDocument).toBe(true),
  );
  expect(view.result.current.canDeleteContextMenuDocument).toBe(false);
  view.unmount();
});
