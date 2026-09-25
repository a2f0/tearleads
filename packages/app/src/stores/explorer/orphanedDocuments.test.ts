import { expect, test } from "bun:test";
import {
  createExplorerOrphanedDocumentsNode,
  EXPLORER_ORPHANED_DOCUMENTS_ID,
  explorerDocumentQueryContainerId,
  explorerDocumentRouteContainerId,
  isExplorerDocumentContainerSelection,
  listLocalOrphanFolders,
} from "./orphanedDocuments";

test("orphan recovery collection maps between route identity and null storage scope", () => {
  const node = createExplorerOrphanedDocumentsNode(
    "org-1",
    "Orphaned Documents",
  );

  expect(node).toMatchObject({
    effectiveAccessLevel: "read",
    id: EXPLORER_ORPHANED_DOCUMENTS_ID,
    name: "Orphaned Documents",
    organizationId: "org-1",
    parentId: null,
  });
  expect(explorerDocumentQueryContainerId(node.id)).toBeNull();
  expect(explorerDocumentRouteContainerId(null)).toBe(node.id);
  expect(isExplorerDocumentContainerSelection(node.id, null)).toBe(true);
  expect(isExplorerDocumentContainerSelection(node.id, "folder-1")).toBe(false);
});

test("a synced shared folder with an inaccessible parent is not recovery work", () => {
  const shared = {
    ...createExplorerOrphanedDocumentsNode("org-1", "Shared folder"),
    id: "shared",
    parentId: "inaccessible-parent",
    metadataDocumentId: "shared-metadata",
  };
  expect(listLocalOrphanFolders([shared], "org-1", new Set())).toEqual([]);
  expect(
    listLocalOrphanFolders([shared], "org-1", new Set([shared.id])),
  ).toEqual([shared]);
});
