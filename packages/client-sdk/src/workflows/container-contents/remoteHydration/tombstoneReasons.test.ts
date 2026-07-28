import { expect, test } from "bun:test";
import { collectRemovedContainers } from "./tombstoneReasons";

const T0 = "2026-01-01T00:00:00.000Z";

function childIndex(
  entries: Record<string, string[]>,
): Map<string, Set<string>> {
  return new Map(
    Object.entries(entries).map(([parentId, childIds]) => [
      parentId,
      new Set(childIds),
    ]),
  );
}

function containers(ids: string[]): Map<string, unknown> {
  return new Map(ids.map((id) => [id, {}]));
}

test("descendants inherit the tombstoned root's reason", () => {
  const { reasonByContainerId, removedContainerIds } = collectRemovedContainers(
    {
      childIdsByParentId: childIndex({ root: ["child"], child: ["grand"] }),
      containersById: containers(["root", "child", "grand"]),
      preservedContainerIds: new Set(),
      tombstones: [
        {
          containerId: "root",
          depth: 0,
          parentId: null,
          reason: "access_revoked",
          updatedAt: T0,
        },
      ],
    },
  );

  expect(removedContainerIds.sort()).toEqual(["child", "grand", "root"]);
  expect(reasonByContainerId.get("child")).toBe("access_revoked");
  expect(reasonByContainerId.get("grand")).toBe("access_revoked");
});

test("a container's own tombstone reason wins over an inherited one", () => {
  const { reasonByContainerId } = collectRemovedContainers({
    childIdsByParentId: childIndex({ root: ["child"] }),
    containersById: containers(["root", "child"]),
    preservedContainerIds: new Set(),
    tombstones: [
      {
        containerId: "root",
        depth: 0,
        parentId: null,
        reason: "access_revoked",
        updatedAt: T0,
      },
      {
        containerId: "child",
        depth: 1,
        parentId: "root",
        reason: "deleted",
        updatedAt: T0,
      },
    ],
  });

  expect(reasonByContainerId.get("root")).toBe("access_revoked");
  expect(reasonByContainerId.get("child")).toBe("deleted");
});

test("deleted wins over access_revoked when two roots reach a container", () => {
  // The shared descendant is a child of both tombstoned roots via the child
  // index (a re-parent race can produce this transiently).
  const { reasonByContainerId } = collectRemovedContainers({
    childIdsByParentId: childIndex({
      deletedRoot: ["shared"],
      revokedRoot: ["shared"],
    }),
    containersById: containers(["deletedRoot", "revokedRoot", "shared"]),
    preservedContainerIds: new Set(),
    tombstones: [
      {
        containerId: "revokedRoot",
        depth: 0,
        parentId: null,
        reason: "access_revoked",
        updatedAt: T0,
      },
      {
        containerId: "deletedRoot",
        depth: 0,
        parentId: null,
        reason: "deleted",
        updatedAt: T0,
      },
    ],
  });

  expect(reasonByContainerId.get("shared")).toBe("deleted");
});

test("preserved containers are skipped and unknown ids filtered", () => {
  const { removedContainerIds } = collectRemovedContainers({
    childIdsByParentId: childIndex({ root: ["kept", "unknown"] }),
    containersById: containers(["root", "kept"]),
    preservedContainerIds: new Set(["kept"]),
    tombstones: [
      {
        containerId: "root",
        depth: 0,
        parentId: null,
        reason: "deleted",
        updatedAt: T0,
      },
    ],
  });

  expect(removedContainerIds).toEqual(["root"]);
});
