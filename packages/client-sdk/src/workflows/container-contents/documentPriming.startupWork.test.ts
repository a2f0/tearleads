import { expect, test } from "bun:test";
import { createTestExecSql } from "@symcrypt/test-utils";
import { sqlDocumentMoveIntentPersistence } from "../../data/persistence/container-contents/documentMoveIntentPersistence";
import { hasStartupDocumentSyncWork } from "./documentPriming";

// Every unsynced move intent is durable startup work, whatever its status:
// pending replays directly, blocked re-checks its healed condition, and
// denied gets the once-per-launch replay (row 7). A relaunch whose only
// durable work is one of these must still schedule the structural pass.
test("any unsynced move intent counts as startup sync work", async () => {
  const { close, execSql } = await createTestExecSql("startup-work-statuses");
  try {
    expect(await hasStartupDocumentSyncWork(execSql)).toBe(false);

    await sqlDocumentMoveIntentPersistence.enqueueMoveIntent(execSql, {
      documentId: "startup-remote",
      localId: "startup-doc",
      replaceLinkedContainers: false,
      sourceContainerId: "from",
      targetContainerId: "to",
    });
    expect(await hasStartupDocumentSyncWork(execSql)).toBe(true);

    await sqlDocumentMoveIntentPersistence.recordMoveIntentError(execSql, {
      blocked: true,
      documentId: "startup-remote",
      message: "destination not synced yet",
    });
    expect(await hasStartupDocumentSyncWork(execSql)).toBe(true);

    await sqlDocumentMoveIntentPersistence.recordMoveIntentError(execSql, {
      denied: true,
      documentId: "startup-remote",
      message: "denied",
    });
    expect(await hasStartupDocumentSyncWork(execSql)).toBe(true);
  } finally {
    close();
  }
});
