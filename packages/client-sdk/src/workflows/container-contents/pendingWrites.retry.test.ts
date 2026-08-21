import { expect, test } from "bun:test";
import { createDocument, encodeVersionVector } from "@symcrypt/loro";
import { createTestExecSql } from "@symcrypt/test-utils";
import { CONTAINER_METADATA_APP_KIND } from "../../data/persistence/container-contents/containerContentsPersistence";
import { sqlDocumentMoveIntentPersistence } from "../../data/persistence/container-contents/documentMoveIntentPersistence";
import { sqlDocumentsPersistence } from "../../data/persistence/documents/documentsPersistence";
import { DOCUMENTS_APP_KIND } from "../../data/persistence/documents/internal/constants";
import {
  hasRecordedTerminalSyncFailures,
  listDocumentPendingUpdates,
  recordDocumentSyncFailure,
} from "../../data/sqlite/documentPersistence";
import { documentPendingUpdates } from "../../data/sqlite/schema";
import { getClientSQLitePersistenceRuntime } from "../../data/sqlite/sqlitePersistenceRuntime";
import { resetPendingWriteRetryState } from "./pendingWrites";

const LOCAL_ID = "retry-doc";

// The durable re-key cap stops a server that keeps conflicting fresh ids
// from driving a network-speed loop — but a budget burned during an
// unrelated outage (every submit 409ing for other reasons) used to be
// terminal forever: every later pass replayed the exhausted state and the
// write-queue "Retry sync" action could not change the outcome. A manual
// retry is the deliberate, rate-limited signal that conditions changed, so
// it resets the budget and clears the parked failure row.
test("manual retry resets the re-key budget and clears the failure row", async () => {
  const { close, execSql } = await createTestExecSql("pending-retry-reset");
  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    await sqlDocumentsPersistence.enqueuePendingUpdate(execSql, {
      localId: LOCAL_ID,
      partialEndVersionVector: "end",
      partialStartVersionVector: "start",
      updateData: "queued-bytes",
    });
    // Exhaust the durable budget the way yesterday's outage did.
    await getClientSQLitePersistenceRuntime(execSql).runMutation(async (db) => {
      await db.update(documentPendingUpdates).set({ rekeyCount: 5 });
    });
    await recordDocumentSyncFailure(
      execSql,
      { appKind: DOCUMENTS_APP_KIND, localId: LOCAL_ID },
      {
        attemptedAt: new Date().toISOString(),
        message: "Update conflict recovery gave up after 5 re-key attempts",
        status: null,
      },
    );

    await resetPendingWriteRetryState(execSql, {
      localId: LOCAL_ID,
      namespace: null,
      objectKind: "document",
    });

    const [pending] = await listDocumentPendingUpdates(execSql, {
      appKind: DOCUMENTS_APP_KIND,
      localId: LOCAL_ID,
    });
    expect(pending?.rekeyCount).toBe(0);
    expect(await hasRecordedTerminalSyncFailures(execSql)).toBe(false);
  } finally {
    close();
  }
});

test("container retry resets the metadata scope's budget and failure row", async () => {
  const { close, execSql } = await createTestExecSql("pending-retry-container");
  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    // Container metadata re-keys through the same recovery path, so its
    // exhausted budget must reset too — clearing only the failure row would
    // let the next pass re-record it immediately.
    await getClientSQLitePersistenceRuntime(execSql).runMutation(async (db) => {
      await db.insert(documentPendingUpdates).values({
        id: "metadata-update",
        appKind: CONTAINER_METADATA_APP_KIND,
        localId: "retry-container",
        updateData: "metadata-bytes",
        partialStartVersionVector: "start",
        partialEndVersionVector: "end",
        sourceVersionVector: null,
        createdAt: new Date().toISOString(),
        rekeyCount: 5,
      });
    });
    await recordDocumentSyncFailure(
      execSql,
      { appKind: CONTAINER_METADATA_APP_KIND, localId: "retry-container" },
      {
        attemptedAt: new Date().toISOString(),
        message: "Write access denied by the server (403)",
        status: 403,
      },
    );

    await resetPendingWriteRetryState(execSql, {
      localId: "retry-container",
      namespace: null,
      objectKind: "container",
    });

    const [pending] = await listDocumentPendingUpdates(execSql, {
      appKind: CONTAINER_METADATA_APP_KIND,
      localId: "retry-container",
    });
    expect(pending?.rekeyCount).toBe(0);
    expect(await hasRecordedTerminalSyncFailures(execSql)).toBe(false);
  } finally {
    close();
  }
});

// A parked permission-denied move is part of the manual-retry surface: the
// deliberate signal un-parks it, scoped to that document alone — another
// document's parked move stays parked (row 7).
test("manual retry un-parks only that document's denied move", async () => {
  const { close, execSql } = await createTestExecSql("pending-retry-denied");
  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    for (const [doc, local] of [
      ["retry-remote", LOCAL_ID],
      ["other-remote", "other-doc"],
    ] as const) {
      await sqlDocumentMoveIntentPersistence.enqueueMoveIntent(execSql, {
        documentId: doc,
        localId: local,
        replaceLinkedContainers: false,
        sourceContainerId: "from",
        targetContainerId: "to",
      });
      await sqlDocumentMoveIntentPersistence.recordMoveIntentError(execSql, {
        denied: true,
        documentId: doc,
        message: "denied",
      });
    }

    await resetPendingWriteRetryState(execSql, {
      localId: LOCAL_ID,
      namespace: null,
      objectKind: "document",
    });

    expect(
      (
        await sqlDocumentMoveIntentPersistence.listPendingMoveIntents(execSql)
      ).map((intent) => intent.documentId),
    ).toEqual(["retry-remote"]);
    expect(
      await sqlDocumentMoveIntentPersistence.hasDeniedMoveIntents(execSql),
    ).toBe(true);
  } finally {
    close();
  }
});

// A deferred write's only durable content is the history tail ahead of the
// covered frontier — no queued update rows. It is still queued work (the
// panel lists it as a deferred-update candidate), so a manual retry clears
// the failure row; a fully covered document stays failure-only and keeps
// its row as the priming ticket.
test("a deferred-tail-only scope counts as queued work on retry", async () => {
  const { close, execSql } = await createTestExecSql("pending-retry-deferred");
  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    const doc = await createDocument("deferred-tail-retry");
    doc.getText("text").update("covered");
    doc.commit();
    const coveredVersion = encodeVersionVector(doc);
    doc.getText("text").update("covered plus a deferred edit");
    doc.commit();
    const aheadVersion = encodeVersionVector(doc);

    for (const [local, pendingBase] of [
      ["deferred-doc", coveredVersion],
      ["covered-doc", aheadVersion],
    ] as const) {
      await sqlDocumentsPersistence.saveDocument(execSql, {
        id: local,
        containerId: "container",
        documentId: `${local}-remote`,
        text: "",
        snapshotEndVersion: aheadVersion,
        accessEpoch: 1,
        pendingBaseVersion: pendingBase,
      });
      await recordDocumentSyncFailure(
        execSql,
        { appKind: DOCUMENTS_APP_KIND, localId: local },
        {
          attemptedAt: new Date().toISOString(),
          message: "Write access denied by the server (403)",
          status: 403,
        },
      );
      await resetPendingWriteRetryState(execSql, {
        localId: local,
        namespace: null,
        objectKind: "document",
      });
    }

    // The deferred-tail scope's row cleared; the covered scope's survived.
    const failures = await execSql(
      "SELECT local_id AS localId FROM document_sync_failures",
    );
    expect(failures.map((row) => Reflect.get(row, "localId"))).toEqual([
      "covered-doc",
    ]);
  } finally {
    close();
  }
});
