import { expect, test } from "bun:test";
import { createTestExecSql } from "@symcrypt/test-utils";
import { invalidateDocumentSyncPullContinuation } from "../../sqlite/documentPersistence";
import { sqlDocumentsPersistence } from "./documentsPersistence";

test("document pull progress survives saves and clears explicitly", async () => {
  const { close, execSql } = await createTestExecSql(
    "document-pull-continuation-persistence",
  );
  const base = {
    accessEpoch: 1,
    containerId: "root-container",
    documentId: "remote-document",
    id: "local-document",
    snapshotEndVersion: "end-version-1",
    text: "content",
  };

  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    await sqlDocumentsPersistence.saveDocument(execSql, {
      ...base,
      pullContinuation: {
        commitLsn: "0/2",
        commitLsnMode: "tracked",
        cursor: "page-2",
      },
    });
    await sqlDocumentsPersistence.saveDocument(execSql, {
      ...base,
      text: "metadata-only save",
    });

    expect(
      (await sqlDocumentsPersistence.loadDocument(execSql, base.id))
        ?.pullContinuation,
    ).toEqual({
      commitLsn: "0/2",
      commitLsnMode: "tracked",
      cursor: "page-2",
    });

    await sqlDocumentsPersistence.saveDocument(execSql, {
      ...base,
      pullContinuation: null,
    });
    expect(
      (await sqlDocumentsPersistence.loadDocument(execSql, base.id))
        ?.pullContinuation,
    ).toBeUndefined();
  } finally {
    close();
  }
});

test("cursor invalidation cannot clear progress advanced by another pane", async () => {
  const { close, execSql } = await createTestExecSql(
    "document-pull-continuation-conditional-clear",
  );
  const rejectedContinuation = {
    commitLsn: "0/2",
    commitLsnMode: "tracked" as const,
    cursor: "page-2",
  };
  const advancedContinuation = {
    commitLsn: "0/3",
    commitLsnMode: "tracked" as const,
    cursor: "page-3",
  };
  const record = {
    accessEpoch: 1,
    containerId: "container-1",
    documentId: "remote-1",
    id: "local-1",
    pullContinuation: advancedContinuation,
    snapshotEndVersion: "",
    text: "",
  };

  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    await sqlDocumentsPersistence.saveDocument(execSql, record);
    await invalidateDocumentSyncPullContinuation(execSql, {
      accessEpoch: record.accessEpoch,
      accessStateHash: null,
      appKind: "documents",
      continuation: rejectedContinuation,
      contentKeyBundle: null,
      documentId: record.documentId,
      documentKekTargets: null,
      documentManifestBundle: null,
      lastCommitLsn: null,
      localId: record.id,
    });

    expect(
      (await sqlDocumentsPersistence.loadDocument(execSql, record.id))
        ?.pullContinuation,
    ).toEqual(advancedContinuation);
  } finally {
    close();
  }
});

test("cursor invalidation leaves a durable page-one recovery marker", async () => {
  const { close, execSql } = await createTestExecSql(
    "document-pull-continuation-rejected-recovery",
  );
  const rejectedContinuation = {
    commitLsn: "0/2",
    commitLsnMode: "tracked" as const,
    cursor: "page-2",
  };
  const record = {
    accessEpoch: 1,
    containerId: "container-1",
    documentId: "remote-1",
    id: "local-1",
    pullContinuation: rejectedContinuation,
    snapshotEndVersion: "version-1",
    text: "content",
  };

  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    await sqlDocumentsPersistence.saveDocument(execSql, record);
    const invalidated = await invalidateDocumentSyncPullContinuation(execSql, {
      accessEpoch: record.accessEpoch,
      accessStateHash: null,
      appKind: "documents",
      continuation: rejectedContinuation,
      contentKeyBundle: null,
      documentId: record.documentId,
      documentKekTargets: null,
      documentManifestBundle: null,
      lastCommitLsn: null,
      localId: record.id,
    });

    expect(invalidated?.pullContinuation).toBeUndefined();
    expect(invalidated?.pullContinuationRecoveryRequired).toBe(true);
    if (!invalidated) throw new Error("Expected invalidated document");

    await sqlDocumentsPersistence.saveDocument(execSql, {
      ...invalidated,
      containerId: record.containerId,
      text: "local save while page-one retry is offline",
    });
    expect(
      (await sqlDocumentsPersistence.loadDocument(execSql, record.id))
        ?.pullContinuationRecoveryRequired,
    ).toBe(true);

    await sqlDocumentsPersistence.saveDocument(execSql, {
      ...invalidated,
      containerId: record.containerId,
      pullContinuation: null,
      text: record.text,
    });
    const recovered = await sqlDocumentsPersistence.loadDocument(
      execSql,
      record.id,
    );
    expect(recovered?.pullContinuation).toBeUndefined();
    expect(recovered?.pullContinuationRecoveryRequired).toBeUndefined();
  } finally {
    close();
  }
});

test("a malformed durable cursor survives restart and local saves until recovery", async () => {
  const { close, execSql } = await createTestExecSql(
    "document-pull-continuation-malformed-restart",
  );
  const base = {
    accessEpoch: 1,
    containerId: "container-1",
    contentKeyBundle: "content-key",
    documentId: "remote-1",
    documentKekTargets: "targets",
    documentManifestBundle: "manifest",
    id: "local-1",
    lastCommitLsn: "0/2",
    snapshotEndVersion: "version-1",
    text: "content",
  };
  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    await sqlDocumentsPersistence.saveDocument(execSql, base);
    await execSql(
      "UPDATE documents SET pull_continuation = :cursor WHERE app_kind = 'documents' AND local_id = :localId",
      { ":cursor": "not-json", ":localId": base.id },
    );

    const restarted = await sqlDocumentsPersistence.loadDocument(
      execSql,
      base.id,
    );
    expect(restarted?.pullContinuation).toBeUndefined();
    expect(restarted?.pullContinuationRecoveryRequired).toBe(true);
    if (!restarted) throw new Error("Expected the malformed record to load");

    await sqlDocumentsPersistence.saveDocument(execSql, {
      ...restarted,
      text: "local save before recovery",
    });
    expect(
      await execSql(
        "SELECT pull_continuation FROM documents WHERE app_kind = 'documents' AND local_id = :localId",
        { ":localId": base.id },
      ),
    ).toEqual([{ pull_continuation: "not-json" }]);

    await sqlDocumentsPersistence.saveDocument(execSql, {
      ...restarted,
      pullContinuation: null,
    });
    expect(
      await execSql(
        "SELECT pull_continuation FROM documents WHERE app_kind = 'documents' AND local_id = :localId",
        { ":localId": base.id },
      ),
    ).toEqual([{ pull_continuation: null }]);
  } finally {
    close();
  }
});
