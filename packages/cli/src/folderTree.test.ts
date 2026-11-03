import { expect, test } from "bun:test";
import type { ContainerNode } from "@tearleads/client-sdk";
import { formatFolderTree } from "./folderTree";

function folder(
  id: string,
  name: string,
  parentId: string | null,
  extra: Partial<ContainerNode> = {},
): ContainerNode {
  return {
    id,
    kind: "container",
    name,
    organizationId: "org-1",
    parentId,
    syncState: {
      lastError: null,
      pendingAttachmentBytes: 0,
      pendingAttachmentCount: 0,
      pendingUpdateCount: 0,
      status: "synced",
    },
    ...extra,
  };
}

test("folders render as a name-sorted tree of one organization", () => {
  const nodes = [
    folder("root", "Home", null),
    folder("b", "Beta", "root"),
    folder("a", "Alpha", "root"),
    folder("a1", "Inner", "a"),
    folder("pending", "", "root", { metadataReady: false }),
    folder("orphan", "Shared", "missing-parent"),
    folder("other", "Elsewhere", null, { organizationId: "org-2" }),
  ];

  expect(formatFolderTree(nodes, "org-1")).toEqual([
    "Home  root",
    "  (name not synced)  pending",
    "  Alpha  a",
    "    Inner  a1",
    "  Beta  b",
    "Shared  orphan",
  ]);
});
