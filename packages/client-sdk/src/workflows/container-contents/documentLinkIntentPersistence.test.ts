import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { sqlContainerContentsPersistence as containers } from "../../data/persistence/container-contents/containerContentsPersistence";
import { reassignContainerDocumentsInTransaction } from "../../data/persistence/container-contents/containerDocumentReassignment";
import { sqlDocumentMoveIntentPersistence as intents } from "../../data/persistence/container-contents/documentMoveIntentPersistence";
import { sqlDocumentContainerProjectionPersistence as links } from "../../data/persistence/containers/documentContainerProjectionPersistence";
import { sqlDocumentsPersistence as documents } from "../../data/persistence/documents/documentsPersistence";
import { getClientSQLitePersistenceRuntime } from "../../data/sqlite/sqlitePersistenceRuntime";
import { createExecSql } from "../../data/sqlite/sqlSchema";
import { hasStartupDocumentSyncWork } from "./documentPriming";
import {
  listPendingWrites,
  resetPendingWriteRetryState,
} from "./pendingWrites";

test("multiple queued links coalesce without replacing each other and follow a subsequent move", async () => {
  const { execSql, close } = await createTestExecSql("queued-link-coalesce");
  try {
    const base = {
      documentId: "remote",
      localId: "local",
      sourceContainerId: "source",
    };
    await Promise.all(
      ["one", "two"].map((targetContainerId) =>
        intents.enqueueLinkIntent(execSql, { ...base, targetContainerId }),
      ),
    );
    const [original] = await intents.listPendingMoveIntents(execSql);
    expect(original).toMatchObject({
      sourceContainerId: "source",
      targetContainerId: "source",
      additionalLinkContainerIds: ["one", "two"],
    });
    await intents.enqueueMoveIntent(execSql, {
      ...base,
      targetContainerId: "destination",
    });
    expect(await intents.listPendingMoveIntents(execSql)).toMatchObject([
      {
        sourceContainerId: "source",
        targetContainerId: "destination",
        additionalLinkContainerIds: ["one", "two"],
      },
    ]);
    if (!original) throw new Error("Missing original intent");
    expect(
      await intents.markMoveIntentSynced(execSql, {
        documentId: "remote",
        expectedIntentId: original.id,
        expectedUpdatedAt: original.updatedAt,
      }),
    ).toBe(false);
    await intents.enqueueMoveIntent(execSql, {
      ...base,
      targetContainerId: "trash",
      replaceLinkedContainers: true,
    });
    expect(
      (await intents.listPendingMoveIntents(execSql))[0]
        ?.additionalLinkContainerIds,
    ).toBeUndefined();
    expect(await execSql("SELECT * FROM document_intent_link_targets")).toEqual(
      [],
    );
  } finally {
    close();
  }
});

test("container reassignment retargets pending additions and invalidates their replay revision", async () => {
  const { execSql, close } = await createTestExecSql("queued-link-retarget");
  try {
    await documents.ensureSchema(execSql);
    await intents.enqueueLinkIntent(execSql, {
      documentId: "remote",
      localId: "local",
      sourceContainerId: "source",
      targetContainerId: "deleted",
    });
    const [original] = await intents.listPendingMoveIntents(execSql);
    await getClientSQLitePersistenceRuntime(execSql).transaction((tx) =>
      reassignContainerDocumentsInTransaction({
        tx,
        fromContainerId: "deleted",
        toContainerId: "lost-found",
        updatedAt: new Date().toISOString(),
      }),
    );
    const [retargeted] = await intents.listPendingMoveIntents(execSql);
    expect(retargeted).toMatchObject({
      sourceContainerId: "source",
      targetContainerId: "source",
      additionalLinkContainerIds: ["lost-found"],
      syncStatus: "pending",
    });
    expect(retargeted?.id).not.toBe(original?.id);
    expect(
      await execSql(
        "SELECT container_id AS target FROM document_intent_link_targets",
      ),
    ).toEqual([{ target: "lost-found" }]);
  } finally {
    close();
  }
});

test.each(["deleted", "access_revoked"] as const)(
  "%s containers cannot block surviving link additions and removals",
  async (reason) => {
    const { execSql, close } = await createTestExecSql(
      `link-removal-${reason}`,
    );
    try {
      await documents.ensureSchema(execSql);
      await containers.ensureSchema(execSql);
      const base = {
        documentId: "remote",
        localId: "local",
        sourceContainerId: "source",
      };
      for (const targetContainerId of ["gone", "surviving"])
        await intents.enqueueLinkIntent(execSql, {
          ...base,
          targetContainerId,
        });
      await intents.enqueueUnlinkIntent(execSql, {
        ...base,
        targetContainerId: "source",
        removedContainerId: "revoked-link",
      });
      const [original] = await intents.listPendingMoveIntents(execSql);
      if (!original) throw new Error("Missing intent");
      await links.replaceDocumentLinks(
        execSql,
        "remote",
        ["source", "gone", "surviving"],
        { moveIntentId: original.id },
      );
      await intents.recordMoveIntentError(execSql, {
        documentId: "remote",
        unavailable: true,
        message: "deleted target",
      });
      await containers.deleteContainers(
        execSql,
        ["source", "gone"].map((containerId) => ({
          containerId,
          reason,
          updatedAt: new Date().toISOString(),
        })),
      );
      const [repaired] = await intents.listPendingMoveIntents(execSql);
      expect(repaired).toMatchObject({
        intentType: "document.link",
        targetContainerId: "surviving",
        additionalLinkContainerIds: ["surviving"],
        removedLinkContainerIds: ["revoked-link"],
        syncStatus: "pending",
        lastError: null,
      });
      expect(repaired?.id).not.toBe(original.id);
      expect(
        await intents.markMoveIntentSynced(execSql, {
          documentId: "remote",
          expectedIntentId: original.id,
          expectedUpdatedAt: original.updatedAt,
        }),
      ).toBe(false);
      expect(await links.listLinkedContainerIds(execSql, "remote")).toEqual([
        "surviving",
      ]);
      expect(
        await execSql(
          "SELECT container_id AS target FROM document_intent_link_targets ORDER BY container_id",
        ),
      ).toEqual([{ target: "revoked-link" }, { target: "surviving" }]);
      await containers.deleteContainer(execSql, "surviving", {
        updatedAt: new Date().toISOString(),
      });
      expect(await intents.listPendingMoveIntents(execSql)).toEqual([]);
    } finally {
      close();
    }
  },
);

test("deleting the only queued addition clears its intent without losing surviving placement", async () => {
  const { execSql, close } = await createTestExecSql("link-removal-empty");
  try {
    await documents.ensureSchema(execSql);
    await containers.ensureSchema(execSql);
    await intents.enqueueLinkIntent(execSql, {
      documentId: "remote",
      localId: "local",
      sourceContainerId: "source",
      targetContainerId: "gone",
    });
    const [intent] = await intents.listPendingMoveIntents(execSql);
    if (!intent) throw new Error("Missing intent");
    await links.replaceDocumentLinks(execSql, "remote", ["source", "gone"], {
      moveIntentId: intent.id,
    });
    await containers.deleteContainer(execSql, "gone", {
      updatedAt: new Date().toISOString(),
    });
    expect(await intents.listPendingMoveIntents(execSql)).toEqual([]);
    expect(await execSql("SELECT * FROM document_intent_link_targets")).toEqual(
      [],
    );
    expect(await links.listLinkedContainerIds(execSql, "remote")).toEqual([
      "source",
    ]);
  } finally {
    close();
  }
});

test("explicit link intents remain visible and retryable after a permission denial", async () => {
  const { execSql, close } = await createTestExecSql("queued-link-denied");
  try {
    await intents.enqueueLinkIntent(execSql, {
      documentId: "remote",
      localId: "local",
      sourceContainerId: "source",
      targetContainerId: "destination",
    });
    expect(await hasStartupDocumentSyncWork(execSql)).toBe(true);
    expect(
      (await listPendingWrites(execSql)).some(
        (item) => item.localId === "local",
      ),
    ).toBe(true);
    await intents.recordMoveIntentError(execSql, {
      documentId: "remote",
      denied: true,
      message: "permission denied",
    });
    expect(await intents.hasDeniedMoveIntents(execSql)).toBe(true);
    expect(await intents.listPendingMoveIntents(execSql)).toEqual([]);
    await resetPendingWriteRetryState(execSql, {
      localId: "local",
      objectKind: "document",
      namespace: null,
    });
    expect(await intents.listPendingMoveIntents(execSql)).toMatchObject([
      {
        intentType: "document.link",
        syncStatus: "pending",
        additionalLinkContainerIds: ["destination"],
      },
    ]);
  } finally {
    close();
  }
});

test("revoked container access does not acknowledge a pending document unlink", async () => {
  const { execSql, close } = await createTestExecSql("link-revoked-unlink");
  try {
    await documents.ensureSchema(execSql);
    await containers.ensureSchema(execSql);
    await intents.enqueueUnlinkIntent(execSql, {
      documentId: "remote",
      localId: "local",
      targetContainerId: "source",
      removedContainerId: "revoked",
    });
    const [original] = await intents.listPendingMoveIntents(execSql);
    if (!original) throw new Error("Missing intent");
    await links.replaceDocumentLinks(execSql, "remote", ["source"], {
      moveIntentId: original.id,
    });
    await containers.deleteContainers(execSql, [
      {
        containerId: "revoked",
        reason: "access_revoked",
        updatedAt: new Date().toISOString(),
      },
    ]);
    expect(await intents.listPendingMoveIntents(execSql)).toMatchObject([
      {
        intentType: "document.link",
        targetContainerId: "source",
        removedLinkContainerIds: ["revoked"],
      },
    ]);
  } finally {
    close();
  }
});

test.each([
  ["unrelated", "destination"],
  ["destination", "active-link"],
])(
  "unlink of %s preserves only the surviving move destination",
  async (removedContainerId, expectedDestination) => {
    const { execSql, close } = await createTestExecSql(
      `move-unlink-${removedContainerId}`,
    );
    try {
      await intents.enqueueMoveIntent(execSql, {
        documentId: "remote",
        localId: "local",
        sourceContainerId: "source",
        targetContainerId: "destination",
      });
      await intents.enqueueUnlinkIntent(execSql, {
        documentId: "remote",
        localId: "local",
        targetContainerId: "active-link",
        removedContainerId,
      });
      expect(await intents.listPendingMoveIntents(execSql)).toMatchObject([
        {
          targetContainerId: expectedDestination,
          removedLinkContainerIds: [removedContainerId, "source"].sort(),
        },
      ]);
    } finally {
      close();
    }
  },
);

test("replay waits for an enqueue transaction's parent and targets to commit together", async () => {
  const { execSql: underlying, close } =
    await createTestExecSql("link-atomic-read");
  const parentWritten = Promise.withResolvers<void>();
  const releaseWriter = Promise.withResolvers<void>();
  const execSql = createExecSql({
    exec: async ({ sql, bind, rowMode }) => {
      const rows = await underlying(
        sql,
        bind,
        rowMode ? { rowMode } : undefined,
      );
      if (sql.startsWith('insert into "document_move_intents"')) {
        parentWritten.resolve();
        await releaseWriter.promise;
      }
      return { rows };
    },
  });
  try {
    await intents.ensureSchema(execSql);
    const enqueue = intents.enqueueLinkIntent(execSql, {
      id: "atomic-link",
      documentId: "remote",
      localId: "local",
      sourceContainerId: "source",
      targetContainerId: "destination",
    });
    await parentWritten.promise;
    let observedBeforeCommit = false;
    const replay = intents.listPendingMoveIntents(execSql).then((rows) => {
      observedBeforeCommit = true;
      return rows;
    });
    await Bun.sleep(20);
    const readIncompleteTransaction = observedBeforeCommit;
    releaseWriter.resolve();
    await enqueue;
    const read = await replay;
    expect(readIncompleteTransaction).toBe(false);
    expect(read).toMatchObject([
      {
        id: "atomic-link",
        additionalLinkContainerIds: ["destination"],
      },
    ]);
  } finally {
    releaseWriter.resolve();
    close();
  }
});
