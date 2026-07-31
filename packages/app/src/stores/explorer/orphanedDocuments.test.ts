import { expect, test } from "bun:test";
import {
  createExplorerOrphanedDocumentsNode,
  EXPLORER_ORPHANED_DOCUMENTS_ID,
  explorerDocumentQueryContainerId,
  explorerDocumentRouteContainerId,
  isExplorerDocumentContainerSelection,
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
