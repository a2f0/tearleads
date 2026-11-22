import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { sqlDocumentsPersistence } from "../../../../data/persistence/documents/documentsPersistence";
import { listPendingDownloads } from "../../../../workflows/container-contents/documentQueries/pendingDownloads";
import { isQueuedForDownload } from "./downloadCompletion";

const base = {
  accessEpoch: 1,
  containerId: "container-1",
  contentKeyBundle: "content-key",
  documentKekTargets: "targets",
  documentManifestBundle: "manifest",
  lastCommitLsn: "0/2",
  text: "content",
};

const continuation = {
  commitLsn: "0/3",
  commitLsnMode: "tracked" as const,
  cursor: "page-2",
};

// The completion check decides from the record in memory what the queue
// decides in SQL; each stored state must get the same answer from both.
test("the document queue rule matches listPendingDownloads for every stored state", async () => {
  const { close, execSql } = await createTestExecSql("download-queue-rule");
  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    const states = {
      draft: { ...base, documentId: null, snapshotEndVersion: "" },
      paging: {
        ...base,
        documentId: "remote-paging",
        pullContinuation: continuation,
        snapshotEndVersion: "version-1",
      },
      recovering: {
        ...base,
        documentId: "remote-recovering",
        snapshotEndVersion: "version-1",
      },
      shell: { ...base, documentId: "remote-shell", snapshotEndVersion: "" },
      stored: {
        ...base,
        documentId: "remote-stored",
        snapshotEndVersion: "version-1",
      },
    };
    for (const [id, record] of Object.entries(states))
      await sqlDocumentsPersistence.saveDocument(execSql, { ...record, id });
    await execSql(
      "UPDATE documents SET pull_continuation = :cursor WHERE app_kind = 'documents' AND local_id = :localId",
      { ":cursor": "not-json", ":localId": "recovering" },
    );

    const queued = new Set(
      (await listPendingDownloads(execSql)).map((item) => item.localId),
    );
    expect([...queued].sort()).toEqual(["paging", "recovering", "shell"]);
    for (const id of Object.keys(states)) {
      const record = await sqlDocumentsPersistence.loadDocument(execSql, id);
      if (!record) throw new Error(`Expected stored ${id}`);
      expect({ id, queued: isQueuedForDownload(record) }).toEqual({
        id,
        queued: queued.has(id),
      });
    }
  } finally {
    close();
  }
});
