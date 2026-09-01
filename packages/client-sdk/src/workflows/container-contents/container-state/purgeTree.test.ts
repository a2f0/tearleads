import { describe, expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { sqlDocumentContainerProjectionPersistence } from "../../../data/persistence/containers/documentContainerProjectionPersistence";
import { sqlDocumentsPersistence } from "../../../data/persistence/documents/documentsPersistence";
import type { ContainerState } from "../remoteHydration";
import {
  classifySubtreeDocument,
  collectSubtreeLeafFirst,
  purgeContainerTree,
} from "./purgeTree";

function containerState(id: string, parentId: string | null): ContainerState {
  // Only the fields the subtree walk reads are populated; the rest of
  // ContainerState is irrelevant to ordering.
  return {
    container: { id, parentId },
  } as unknown as ContainerState;
}

function containersById(
  states: ReadonlyArray<ContainerState>,
): ReadonlyMap<string, ContainerState> {
  return new Map(states.map((state) => [state.container.id, state]));
}

describe("collectSubtreeLeafFirst", () => {
  test("returns the root last so containers delete leaf-first", () => {
    // root -> a -> a1, a -> a2; b under root
    const map = containersById([
      containerState("root", null),
      containerState("a", "root"),
      containerState("a1", "a"),
      containerState("a2", "a"),
      containerState("b", "root"),
    ]);

    const order = collectSubtreeLeafFirst(map, "root").map(
      (state) => state.container.id,
    );

    // Every child must appear before its parent.
    expect(order.indexOf("a1")).toBeLessThan(order.indexOf("a"));
    expect(order.indexOf("a2")).toBeLessThan(order.indexOf("a"));
    expect(order.indexOf("a")).toBeLessThan(order.indexOf("root"));
    expect(order.indexOf("b")).toBeLessThan(order.indexOf("root"));
    expect(order.at(-1)).toBe("root");
    expect(order).toHaveLength(5);
  });

  test("collects only the targeted subtree, not unrelated containers", () => {
    const map = containersById([
      containerState("root", null),
      containerState("trash", "root"),
      containerState("trashed", "trash"),
      containerState("trashed-child", "trashed"),
      containerState("other", "root"),
    ]);

    const order = collectSubtreeLeafFirst(map, "trashed").map(
      (state) => state.container.id,
    );

    expect(order).toEqual(["trashed-child", "trashed"]);
    expect(order).not.toContain("trash");
    expect(order).not.toContain("other");
  });

  test("tolerates a cyclic parent chain without looping forever", () => {
    const map = containersById([
      containerState("x", "y"),
      containerState("y", "x"),
    ]);

    const order = collectSubtreeLeafFirst(map, "x").map(
      (state) => state.container.id,
    );

    // Both are visited once; the cycle guard prevents re-enqueue.
    expect(new Set(order)).toEqual(new Set(["x", "y"]));
  });
});

describe("classifySubtreeDocument", () => {
  const subtreeContainerIds = new Set(["trashed", "trashed-child"]);

  test("purges a synced document linked only inside the subtree", () => {
    expect(
      classifySubtreeDocument({
        documentId: "doc-1",
        linkedContainerIds: ["trashed"],
        subtreeContainerIds,
      }),
    ).toEqual({ kind: "purge", unlinkContainerIds: [] });
  });

  test("purges a synced document even when linked to several in-subtree folders", () => {
    expect(
      classifySubtreeDocument({
        documentId: "doc-1",
        linkedContainerIds: ["trashed", "trashed-child"],
        subtreeContainerIds,
      }),
    ).toEqual({
      kind: "purge",
      unlinkContainerIds: ["trashed-child"],
    });
  });

  test("unlinks (preserves) a document also linked outside the subtree", () => {
    // The user's requirement: a document kept in another folder must NOT be
    // destroyed — only unlinked from the trashed subtree.
    expect(
      classifySubtreeDocument({
        documentId: "doc-1",
        linkedContainerIds: ["trashed", "keep-me"],
        subtreeContainerIds,
      }),
    ).toEqual({ kind: "unlink", containerIds: ["trashed"] });
  });

  test("unlink only targets the in-subtree containers, never the external ones", () => {
    expect(
      classifySubtreeDocument({
        documentId: "doc-1",
        linkedContainerIds: ["trashed", "trashed-child", "keep-a", "keep-b"],
        subtreeContainerIds,
      }),
    ).toEqual({
      kind: "unlink",
      containerIds: ["trashed", "trashed-child"],
    });
  });

  test("purges a never-synced document locally", () => {
    expect(
      classifySubtreeDocument({
        documentId: null,
        linkedContainerIds: [],
        subtreeContainerIds,
      }),
    ).toEqual({ kind: "purge-local" });
  });
});

test("purgeContainerTree unlinks extra internal links before remote purge", async () => {
  const { close, execSql } = await createTestExecSql(
    "purge-tree-multi-link-document",
  );
  const controller = new AbortController();
  const operations: string[] = [];
  const documentId = "remote-multi-link-document";

  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    await sqlDocumentsPersistence.saveDocument(
      execSql,
      {
        accessEpoch: 1,
        accessStateHash: "document-access-state",
        containerId: "trashed",
        documentId,
        documentKind: "note",
        id: "local-multi-link-document",
        snapshotEndVersion: "",
        text: "",
        title: "Multi-link document",
      },
      { updatedAt: "2026-08-27T00:00:00.000Z" },
    );
    await sqlDocumentContainerProjectionPersistence.replaceDocumentLinks(
      execSql,
      documentId,
      ["trashed", "trashed-child"],
    );

    const result = await purgeContainerTree({
      containersById: containersById([
        containerState("trashed", null),
        containerState("trashed-child", "trashed"),
      ]),
      documentOperations: {
        purgeLocal: async () => {
          throw new Error("Unexpected local purge");
        },
        purgeRemote: async (document) => {
          operations.push(`purge:${document.documentId}`);
          controller.abort();
          return true;
        },
        unlink: async (document, containerIds) => {
          operations.push(
            `unlink:${document.documentId}:${containerIds.join(",")}`,
          );
          return true;
        },
      },
      persistence: {} as never,
      prepareDocumentRotationSnapshot: async () => {
        throw new Error("Unexpected rotation snapshot preparation");
      },
      resolveProjectionUserKey: async () => null,
      rootContainerId: "trashed",
      runtime: { infra: { execSql } } as never,
      signal: controller.signal,
    });

    expect(operations).toEqual([
      `unlink:${documentId}:trashed-child`,
      `purge:${documentId}`,
    ]);
    expect(result).toMatchObject({
      aborted: true,
      completedCount: 1,
      failedCount: 0,
      totalCount: 3,
    });
  } finally {
    close();
  }
});

test("purgeContainerTree stops at the next document when its generation expires", async () => {
  const { close, execSql } = await createTestExecSql(
    "purge-tree-generation-boundary",
  );
  let current = true;
  const purgedDocuments: string[] = [];

  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    for (const id of ["local-document-a", "local-document-b"]) {
      await sqlDocumentsPersistence.saveDocument(
        execSql,
        {
          accessEpoch: 1,
          accessStateHash: null,
          containerId: "trashed",
          documentId: null,
          documentKind: "note",
          id,
          snapshotEndVersion: "",
          text: "",
          title: id,
        },
        { updatedAt: "2026-09-01T00:00:00.000Z" },
      );
    }

    const result = await purgeContainerTree({
      containersById: containersById([containerState("trashed", null)]),
      documentOperations: {
        purgeLocal: async (document) => {
          purgedDocuments.push(document.id);
          current = false;
          return true;
        },
        purgeRemote: async () => {
          throw new Error("Unexpected remote purge");
        },
        unlink: async () => {
          throw new Error("Unexpected unlink");
        },
      },
      persistence: {} as never,
      prepareDocumentRotationSnapshot: async () => null,
      resolveProjectionUserKey: async () => null,
      rootContainerId: "trashed",
      runtime: { infra: { execSql } } as never,
      stillCurrent: () => current,
    });

    expect(purgedDocuments).toHaveLength(1);
    expect(result).toMatchObject({
      aborted: true,
      completedCount: 1,
      failedCount: 0,
      totalCount: 3,
    });
  } finally {
    close();
  }
});

test("purgeContainerTree reports zero completions after a later unlink fails", async () => {
  const database = await createTestExecSql(
    "purge-tree-partial-document-unlink",
  );
  const documentId = "partially-unlinked-document";
  const unlinkAttempts: string[] = [];
  let current = true;

  try {
    await sqlDocumentsPersistence.ensureSchema(database.execSql);
    await sqlDocumentsPersistence.saveDocument(
      database.execSql,
      {
        accessEpoch: 1,
        accessStateHash: "document-access-state",
        containerId: "trashed",
        documentId,
        documentKind: "note",
        id: "local-partially-unlinked-document",
        snapshotEndVersion: "",
        text: "",
        title: "Partially unlinked document",
      },
      { updatedAt: "2026-09-01T00:00:00.000Z" },
    );
    await sqlDocumentContainerProjectionPersistence.replaceDocumentLinks(
      database.execSql,
      documentId,
      ["trashed", "trashed-child", "outside"],
    );

    const result = await purgeContainerTree({
      containersById: containersById([
        containerState("trashed", null),
        containerState("trashed-child", "trashed"),
      ]),
      documentOperations: {
        purgeLocal: async () => {
          throw new Error("Unexpected local purge");
        },
        purgeRemote: async () => {
          throw new Error("Unexpected remote purge");
        },
        unlink: async (_document, containerIds) => {
          for (const containerId of containerIds) {
            unlinkAttempts.push(containerId);
            if (unlinkAttempts.length === 2) {
              current = false;
              return false;
            }
          }
          return true;
        },
      },
      persistence: {} as never,
      prepareDocumentRotationSnapshot: async () => null,
      resolveProjectionUserKey: async () => null,
      rootContainerId: "trashed",
      runtime: { infra: { execSql: database.execSql } } as never,
      stillCurrent: () => current,
    });

    expect(unlinkAttempts).toEqual(["trashed", "trashed-child"]);
    expect(result).toMatchObject({
      aborted: true,
      completedCount: 0,
      failedCount: 1,
      purgedContainerIds: [],
      totalCount: 3,
    });
  } finally {
    database.close();
  }
});
