import { expect, test } from "bun:test";
import { createPlacementCommitFixture } from "../../../test/helpers/client/placementCommit";
import { DocumentContainerProjectionRepository as Links } from "../../data/persistence/container-contents/documentContainerProjectionPersistence";
import { DocumentMoveIntentRepository } from "../../data/persistence/container-contents/documentMoveIntentPersistence";
import { sqlDocumentsPersistence as documents } from "../../data/persistence/documents/documentsPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import { relinkDocumentStoreWithCommitSideEffect } from "../../stores/documents/documentStore/internalRelink";
import { settleDocumentMoveIntent } from "../../workflows/container-contents/documentMove/documentMoveIntentSettlement";

const intents = (execSql: ExecSql) => new DocumentMoveIntentRepository(execSql);

test.each(["move", "link", "unlink"] as const)(
  "%s uses one commit without nested worker savepoints",
  async (operation) => {
    const f = await createPlacementCommitFixture();
    try {
      f.db.statements.length = 0;
      expect(await f[operation]()).not.toBeNull();
      const traffic = [...f.db.statements];
      const savepoints = traffic.filter((sql) => /savepoint/i.test(sql));
      console.info("placement-worker-messages", {
        operation,
        messages: traffic.length,
        savepoints,
      });
      expect(await documents.loadDocument(f.db.execSql, "local")).toMatchObject(
        {
          containerId:
            operation === "move"
              ? "trash"
              : operation === "link"
                ? "source-container"
                : "other-container",
        },
      );
      expect(
        await new Links(f.db.execSql).listLinkedContainerIds(f.documentId),
      ).toEqual(
        operation === "move"
          ? ["trash"]
          : operation === "link"
            ? ["other-container", "source-container", "trash"]
            : ["other-container"],
      );
      expect(await intents(f.db.execSql).listPendingMoveIntents()).toHaveLength(
        1,
      );
      expect(traffic.length).toBeLessThanOrEqual(
        { move: 22, link: 24, unlink: 25 }[operation],
      );
      expect(savepoints).toEqual([]);
    } finally {
      await f.db.close();
      await f.db.remove();
    }
  },
);

test("move settlement joins the document commit without worker savepoints", async () => {
  const f = await createPlacementCommitFixture();
  try {
    await f.move();
    const [intent] = await intents(f.db.execSql).listPendingMoveIntents();
    if (!intent) throw new Error("Missing queued move");
    f.db.statements.length = 0;
    await relinkDocumentStoreWithCommitSideEffect(
      f.store,
      {
        localId: "local",
        documentId: f.documentId,
        containerId: "trash",
        accessEpoch: 2,
      },
      (execSql) =>
        settleDocumentMoveIntent({
          execSql,
          intent,
          isCurrent: () => true,
          linkedContainerIds: ["trash"],
          partial: false,
        }),
    );
    const traffic = [...f.db.statements];
    const savepoints = traffic.filter((sql) => /savepoint/i.test(sql));
    console.info("placement-worker-messages", {
      operation: "settlement",
      messages: traffic.length,
      savepoints,
    });
    expect(await documents.loadDocument(f.db.execSql, "local")).toMatchObject({
      containerId: "trash",
      accessEpoch: 2,
    });
    expect(await intents(f.db.execSql).listPendingMoveIntents()).toEqual([]);
    expect(
      await new Links(f.db.execSql).listLinkedContainerIds(f.documentId),
    ).toEqual(["trash"]);
    expect(traffic.length).toBeLessThanOrEqual(14);
    expect(savepoints).toEqual([]);
  } finally {
    await f.db.close();
    await f.db.remove();
  }
});
