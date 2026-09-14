import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  containerTables,
  documentContainerProjectionTables,
  documentProjectionTables,
} from "../../sqlite/schema";
import { getClientSQLitePersistenceRuntime } from "../../sqlite/sqlitePersistenceRuntime";
import { ensureSqlTables } from "../../sqlite/sqlSchema";
import { reassignContainerDocumentsInTransaction } from "./containerDocumentReassignment";
import { sqlDocumentMoveIntentPersistence as persistence } from "./documentMoveIntentPersistence";

const readStatus = async (
  execSql: Awaited<ReturnType<typeof createTestExecSql>>["execSql"],
) =>
  (
    await execSql(
      "SELECT sync_status AS syncStatus FROM document_move_intents WHERE document_id = 'remote'",
    )
  ).map((row) => Reflect.get(row, "syncStatus"));

// #2278 #4: `unavailable` is terminal for the replay lanes. It outranks a
// denial recorded by the same pass, is excluded from the routine replay set
// and from the access-restored reset, and is revived only by the tombstone
// cascade (a local retarget) or a fresh enqueue of the same document.
test("unavailable document move intents park terminally until retargeted", async () => {
  const { close, execSql } = await createTestExecSql(
    "document-move-unavailable",
  );
  try {
    await persistence.ensureSchema(execSql);
    await ensureSqlTables(execSql, [
      ...documentContainerProjectionTables,
      ...documentProjectionTables,
      ...containerTables,
    ]);
    await persistence.enqueueMoveIntent(execSql, {
      documentId: "remote",
      localId: "doc",
      replaceLinkedContainers: false,
      sourceContainerId: "from",
      targetContainerId: "deleted-target",
    });

    await persistence.recordMoveIntentError(execSql, {
      denied: true,
      documentId: "remote",
      message: "Remote document move cites a container deleted on the server",
      unavailable: true,
    });
    expect(await readStatus(execSql)).toEqual(["unavailable"]);
    expect(await persistence.listPendingMoveIntents(execSql)).toEqual([]);
    expect(await persistence.hasDeniedMoveIntents(execSql)).toBe(false);

    // Neither the access-restored reset nor a manual retry revives it: a
    // restored permission cannot bring a deleted container back.
    await persistence.resetDeniedMoveIntents(execSql);
    await persistence.resetDeniedMoveIntents(execSql, { localId: "doc" });
    expect(await readStatus(execSql)).toEqual(["unavailable"]);

    // The tombstone cascade retargets the intent and re-arms it.
    await getClientSQLitePersistenceRuntime(execSql).transaction(async (tx) => {
      await reassignContainerDocumentsInTransaction({
        fromContainerId: "deleted-target",
        toContainerId: "parent",
        tx,
        updatedAt: new Date().toISOString(),
      });
    });
    expect(await persistence.listPendingMoveIntents(execSql)).toMatchObject([
      { syncStatus: "pending", targetContainerId: "parent" },
    ]);

    // A fresh enqueue (the user moves the document again) also re-arms it.
    await persistence.recordMoveIntentError(execSql, {
      documentId: "remote",
      message: "gone again",
      unavailable: true,
    });
    expect(await readStatus(execSql)).toEqual(["unavailable"]);
    await persistence.enqueueMoveIntent(execSql, {
      documentId: "remote",
      localId: "doc",
      sourceContainerId: "from",
      targetContainerId: "elsewhere",
    });
    expect(await persistence.listPendingMoveIntents(execSql)).toMatchObject([
      {
        lastError: null,
        syncStatus: "pending",
        targetContainerId: "elsewhere",
      },
    ]);
  } finally {
    close();
  }
});
