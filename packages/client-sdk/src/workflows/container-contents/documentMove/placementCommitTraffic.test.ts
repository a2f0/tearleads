import { expect, test } from "bun:test";
import { createPlacementCommitFixture } from "../../../../test/helpers/placementCommit";
import { sqlDocumentContainerProjectionPersistence as links } from "../../../data/persistence/container-contents/documentContainerProjectionPersistence";
import { sqlDocumentMoveIntentPersistence as intents } from "../../../data/persistence/container-contents/documentMoveIntentPersistence";
import { sqlDocumentsPersistence as documents } from "../../../data/persistence/documents/documentsPersistence";
import { relinkDocumentStoreWithCommitSideEffect } from "../../../stores/documents/documentStore/internalRelink";
import { settleDocumentMoveIntent } from "./documentMoveIntentSettlement";

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
        await links.listLinkedContainerIds(f.db.execSql, f.documentId),
      ).toEqual(
        operation === "move"
          ? ["trash"]
          : operation === "link"
            ? ["other-container", "source-container", "trash"]
            : ["other-container"],
      );
      expect(await intents.listPendingMoveIntents(f.db.execSql)).toHaveLength(
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
    const [intent] = await intents.listPendingMoveIntents(f.db.execSql);
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
    expect(await intents.listPendingMoveIntents(f.db.execSql)).toEqual([]);
    expect(
      await links.listLinkedContainerIds(f.db.execSql, f.documentId),
    ).toEqual(["trash"]);
    expect(traffic.length).toBeLessThanOrEqual(14);
    expect(savepoints).toEqual([]);
  } finally {
    await f.db.close();
    await f.db.remove();
  }
});
