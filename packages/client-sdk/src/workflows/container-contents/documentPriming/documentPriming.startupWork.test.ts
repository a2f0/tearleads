import { expect, test } from "bun:test";
import { createDocument, encodeVersionVector } from "@tearleads/loro";
import { createTestExecSql } from "@tearleads/test-utils";
import { DocumentMoveIntentRepository } from "../../../data/persistence/container-contents/documentMoveIntentPersistence";
import { sqlDocumentsPersistence } from "../../../data/persistence/documents/documentsPersistence";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import { hasStartupDocumentSyncWork } from "./index";

const moveIntents = (execSql: ExecSql) =>
  new DocumentMoveIntentRepository(execSql);

// Every unsynced move intent is durable startup work, whatever its status:
// pending replays directly, blocked re-checks its healed condition, and
// denied gets the once-per-launch replay (row 7). A relaunch whose only
// durable work is one of these must still schedule the structural pass.
test("any unsynced move intent counts as startup sync work", async () => {
  const { close, execSql } = await createTestExecSql("startup-work-statuses");
  try {
    expect(await hasStartupDocumentSyncWork(execSql)).toBe(false);

    await moveIntents(execSql).enqueueMoveIntent({
      documentId: "startup-remote",
      localId: "startup-doc",
      replaceLinkedContainers: false,
      sourceContainerId: "from",
      targetContainerId: "to",
    });
    expect(await hasStartupDocumentSyncWork(execSql)).toBe(true);

    await moveIntents(execSql).recordMoveIntentError({
      blocked: true,
      documentId: "startup-remote",
      message: "destination not synced yet",
    });
    expect(await hasStartupDocumentSyncWork(execSql)).toBe(true);

    await moveIntents(execSql).recordMoveIntentError({
      denied: true,
      documentId: "startup-remote",
      message: "denied",
    });
    expect(await hasStartupDocumentSyncWork(execSql)).toBe(true);
  } finally {
    close();
  }
});

test("a durable document pull continuation counts as startup sync work", async () => {
  const { close, execSql } = await createTestExecSql(
    "startup-work-pull-continuation",
  );
  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    const document = await createDocument("startup-work-pull-continuation");
    const version = encodeVersionVector(document);
    await sqlDocumentsPersistence.saveDocument(execSql, {
      accessEpoch: 1,
      containerId: "root-container",
      documentId: "remote-partial-document",
      documentKind: "note",
      id: "partial-document",
      pendingBaseVersion: version,
      pullContinuation: {
        commitLsn: "0/2",
        commitLsnMode: "tracked",
        cursor: "page-2",
      },
      snapshotEndVersion: version,
      text: "",
      title: "Partial document",
    });

    expect(await hasStartupDocumentSyncWork(execSql)).toBe(true);
  } finally {
    close();
  }
});
