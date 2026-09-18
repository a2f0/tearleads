import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { reassignContainerDocumentsInTransaction } from "../../data/persistence/container-contents/containerDocumentReassignment";
import { sqlDocumentMoveIntentPersistence as intents } from "../../data/persistence/container-contents/documentMoveIntentPersistence";
import { sqlDocumentsPersistence as documents } from "../../data/persistence/documents/documentsPersistence";
import { getClientSQLitePersistenceRuntime } from "../../data/sqlite/sqlitePersistenceRuntime";

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

test("container deletion retargets pending additions and invalidates their replay revision", async () => {
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
