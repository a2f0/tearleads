import { expect, test } from "bun:test";
import {
  collectRemovedContainers,
  selectRetainedMetadataContainerIds,
} from "./tombstoneReasons";

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

test("descendants inherit the tombstoned root's reason and timestamp", () => {
  const { reasonByContainerId, removalByContainerId, removedContainerIds } =
    collectRemovedContainers({
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
    });

  expect(removedContainerIds.sort()).toEqual(["child", "grand", "root"]);
  expect(reasonByContainerId.get("child")).toBe("access_revoked");
  expect(reasonByContainerId.get("grand")).toBe("access_revoked");
  expect(removalByContainerId.get("grand")?.updatedAt).toBe(T0);
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

test("a deleted tombstone for an absent container lands in the purge list", () => {
  const { purgeMetadataContainerIds, removedContainerIds } =
    collectRemovedContainers({
      childIdsByParentId: childIndex({}),
      containersById: containers([]),
      preservedContainerIds: new Set(),
      tombstones: [
        {
          containerId: "revoked-earlier",
          depth: 0,
          parentId: null,
          reason: "deleted",
          updatedAt: T0,
        },
        {
          containerId: "still-revoked",
          depth: 0,
          parentId: null,
          reason: "access_revoked",
          updatedAt: T0,
        },
      ],
    });

  expect(removedContainerIds).toEqual([]);
  expect(purgeMetadataContainerIds).toEqual(["revoked-earlier"]);
});

test("an upgrade requeues the shared node so grandchildren re-inherit", () => {
  // Tombstone order makes the revoked root walk "shared" (and its
  // grandchild) first; the deleted root's later upgrade must re-walk them.
  const { reasonByContainerId } = collectRemovedContainers({
    childIdsByParentId: childIndex({
      deletedRoot: ["shared"],
      revokedRoot: ["shared"],
      shared: ["grand"],
    }),
    containersById: containers([
      "deletedRoot",
      "revokedRoot",
      "shared",
      "grand",
    ]),
    preservedContainerIds: new Set(),
    tombstones: [
      {
        containerId: "deletedRoot",
        depth: 0,
        parentId: null,
        reason: "deleted",
        updatedAt: T0,
      },
      {
        containerId: "revokedRoot",
        depth: 0,
        parentId: null,
        reason: "access_revoked",
        updatedAt: T0,
      },
    ],
  });

  expect(reasonByContainerId.get("shared")).toBe("deleted");
  expect(reasonByContainerId.get("grand")).toBe("deleted");
});

test("local-only descendants are excluded from metadata retention", () => {
  const containersById = new Map([
    ["root", { container: { metadataDocumentId: "metadata-root" } }],
    ["localChild", { container: { metadataDocumentId: null } }],
  ]);
  const { reasonByContainerId, removedContainerIds } = collectRemovedContainers(
    {
      childIdsByParentId: childIndex({ root: ["localChild"] }),
      containersById,
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

  expect(removedContainerIds.sort()).toEqual(["localChild", "root"]);
  expect(
    selectRetainedMetadataContainerIds({
      containersById,
      ownTombstoneContainerIds: new Set(["root"]),
      reasonByContainerId,
      removedContainerIds,
    }),
  ).toEqual(["root"]);
});

test("an own tombstone proves remote existence for retention", () => {
  // A create whose response was lost leaves metadataDocumentId null locally,
  // but the server only tombstones committed containers — so a container
  // with its OWN access_revoked tombstone is retained despite looking
  // local-only.
  const containersById = new Map([
    ["root", { container: { metadataDocumentId: "metadata-root" } }],
    ["lostCreate", { container: { metadataDocumentId: null } }],
  ]);
  const { ownTombstoneContainerIds, reasonByContainerId, removedContainerIds } =
    collectRemovedContainers({
      childIdsByParentId: childIndex({ root: ["lostCreate"] }),
      containersById,
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
          containerId: "lostCreate",
          depth: 1,
          parentId: "root",
          reason: "access_revoked",
          updatedAt: T0,
        },
      ],
    });

  expect(
    selectRetainedMetadataContainerIds({
      containersById,
      ownTombstoneContainerIds,
      reasonByContainerId,
      removedContainerIds,
    }).sort(),
  ).toEqual(["lostCreate", "root"]);
});
