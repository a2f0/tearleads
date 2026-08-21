import { expect, test } from "bun:test";
import { syncedContainerDocumentObjectSyncState } from "@symcrypt/client-sdk";
import { createExplorerOrphanedDocumentsNode } from "../../../stores/explorer/orphanedDocuments";
import { getExplorerSidebarBlankContextMenuContainerId } from "./ExplorerTree";
import { buildExplorerTree } from "./explorerTreeModel";

test("blank sidebar context menu targets a real container", () => {
  const treeEntries = buildExplorerTree([
    createExplorerOrphanedDocumentsNode("org-1", "A Recovery"),
    {
      id: "root-container",
      kind: "container",
      name: "Z Root",
      organizationId: "org-1",
      parentId: null,
      syncState: syncedContainerDocumentObjectSyncState,
    },
  ]);

  expect(
    getExplorerSidebarBlankContextMenuContainerId(treeEntries, "org-1"),
  ).toBe("root-container");
});
