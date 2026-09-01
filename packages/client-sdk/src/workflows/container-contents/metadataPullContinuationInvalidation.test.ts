import { expect, test } from "bun:test";
import { bytesToBase64 } from "@tearleads/encoding";
import { exportAllUpdates } from "@tearleads/loro";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  createContainerMetadataDocument,
  readContainerMetadataValue,
  writeContainerMetadataValue,
} from "../../data/containers/containerMetadataDocument";
import { sqlContainerContentsPersistence } from "../../data/persistence/container-contents/containerContentsPersistence";
import {
  type ExecSql,
  runSerializedSqlMutation,
} from "../../data/sqlite/sqlSchema";
import {
  createContainerRecord,
  createDocumentRecord,
} from "./metadata.testFixtures";
import { invalidateContainerMetadataPullContinuation } from "./metadataPullContinuationInvalidation";

test("metadata cursor rejection is durable and cannot clear newer progress", async () => {
  const { close, execSql } = await createTestExecSql(
    "metadata-pull-continuation-invalidation",
  );
  const container = createContainerRecord({
    id: "container-1",
    metadataDocumentId: "metadata-document-1",
    parentId: null,
  });
  const rejectedContinuation = {
    commitLsn: "0/2",
    commitLsnMode: "tracked" as const,
    cursor: "metadata-page-2",
  };
  const record = createDocumentRecord({
    documentId: "metadata-document-1",
    id: container.id,
    pullContinuation: rejectedContinuation,
  });
  const metadataState = {
    container,
    doc: await createContainerMetadataDocument(container.id),
    pullContinuation: rejectedContinuation,
    record,
  };

  try {
    await sqlContainerContentsPersistence.ensureSchema(execSql);
    await sqlContainerContentsPersistence.saveContainer(
      execSql,
      container,
      record,
    );
    await invalidateContainerMetadataPullContinuation({
      continuation: rejectedContinuation,
      metadataState,
      persistence: sqlContainerContentsPersistence,
      runtime: { infra: { execSql } },
    });
    expect(metadataState.pullContinuation).toBeNull();
    const invalidated =
      await sqlContainerContentsPersistence.loadContainerMetadataRecord(
        execSql,
        container.id,
      );
    expect(invalidated?.pullContinuation).toBeUndefined();
    expect(invalidated?.pullContinuationRecoveryRequired).toBe(true);
    expect(metadataState.record.pullContinuationRecoveryRequired).toBe(true);

    const advancedContinuation = {
      commitLsn: "0/3",
      commitLsnMode: "tracked" as const,
      cursor: "metadata-page-3",
    };
    const advancedDoc = await createContainerMetadataDocument(container.id);
    writeContainerMetadataValue(advancedDoc, {
      icon: "cloud",
      name: "Advanced page",
    });
    await sqlContainerContentsPersistence.saveContainer(execSql, container, {
      ...record,
      metadataUpdates: bytesToBase64(exportAllUpdates(advancedDoc)),
      pullContinuation: advancedContinuation,
    });
    metadataState.pullContinuation = rejectedContinuation;
    await invalidateContainerMetadataPullContinuation({
      continuation: rejectedContinuation,
      metadataState,
      persistence: sqlContainerContentsPersistence,
      runtime: { infra: { execSql } },
    });
    expect(
      (
        await sqlContainerContentsPersistence.loadContainerMetadataRecord(
          execSql,
          container.id,
        )
      )?.pullContinuation,
    ).toEqual(advancedContinuation);
    expect(metadataState.pullContinuation).toEqual(advancedContinuation);
    expect(metadataState.record.pullContinuation).toEqual(advancedContinuation);
    expect(readContainerMetadataValue(metadataState.doc, "/")).toEqual({
      icon: "cloud",
      name: "Advanced page",
    });
  } finally {
    close();
  }
});

test("expired metadata invalidation cannot persist after waiting for the SQL lock", async () => {
  const { close, execSql } = await createTestExecSql(
    "metadata-pull-continuation-expired",
  );
  const container = createContainerRecord({
    id: "container-expired",
    metadataDocumentId: "metadata-document-expired",
    parentId: null,
  });
  const rejectedContinuation = {
    commitLsn: "0/2",
    commitLsnMode: "tracked" as const,
    cursor: "metadata-page-expired",
  };
  const record = createDocumentRecord({
    documentId: "metadata-document-expired",
    id: container.id,
    pullContinuation: rejectedContinuation,
  });
  const metadataState = {
    container,
    doc: await createContainerMetadataDocument(container.id),
    pullContinuation: rejectedContinuation,
    record,
  };

  try {
    await sqlContainerContentsPersistence.ensureSchema(execSql);
    await sqlContainerContentsPersistence.saveContainer(
      execSql,
      container,
      record,
    );
    let current = true;
    let releaseLock = () => {};
    const lockHeld = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    const blocker = runSerializedSqlMutation(execSql, () => lockHeld);
    const invalidation = invalidateContainerMetadataPullContinuation({
      continuation: rejectedContinuation,
      isCurrent: () => current,
      metadataState,
      persistence: sqlContainerContentsPersistence,
      runtime: { infra: { execSql } },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    current = false;
    releaseLock();
    await Promise.all([blocker, invalidation]);

    const persisted =
      await sqlContainerContentsPersistence.loadContainerMetadataRecord(
        execSql,
        container.id,
      );
    expect(persisted?.pullContinuation).toEqual(rejectedContinuation);
    expect(persisted?.pullContinuationRecoveryRequired).toBeUndefined();
    expect(metadataState.pullContinuation).toEqual(rejectedContinuation);
  } finally {
    close();
  }
});

test("metadata invalidation rolls back when generation expires before commit", async () => {
  const database = await createTestExecSql(
    "metadata-pull-continuation-commit-expired",
  );
  const rejectedContinuation = {
    commitLsn: "0/2",
    commitLsnMode: "tracked" as const,
    cursor: "metadata-page-commit-expired",
  };
  const container = createContainerRecord({
    id: "container-commit-expired",
    metadataDocumentId: "metadata-document-commit-expired",
    parentId: null,
  });
  const record = createDocumentRecord({
    documentId: "metadata-document-commit-expired",
    id: container.id,
    pullContinuation: rejectedContinuation,
  });
  const metadataState = {
    container,
    doc: await createContainerMetadataDocument(container.id),
    pullContinuation: rejectedContinuation,
    record,
  };
  let current = true;
  let observeInvalidation = false;
  const guardedExecSql = (async (...args: Parameters<ExecSql>) => {
    const rows = await database.execSql(...args);
    const sql = args[0].toLowerCase();
    if (
      observeInvalidation &&
      sql.startsWith("update") &&
      sql.includes("pull_continuation")
    ) {
      current = false;
    }
    return rows;
  }) as ExecSql;

  try {
    await sqlContainerContentsPersistence.ensureSchema(guardedExecSql);
    await sqlContainerContentsPersistence.saveContainer(
      guardedExecSql,
      container,
      record,
    );
    observeInvalidation = true;

    await invalidateContainerMetadataPullContinuation({
      continuation: rejectedContinuation,
      isCurrent: () => current,
      metadataState,
      persistence: sqlContainerContentsPersistence,
      runtime: { infra: { execSql: guardedExecSql } },
    });

    expect(current).toBe(false);
    const persisted =
      await sqlContainerContentsPersistence.loadContainerMetadataRecord(
        guardedExecSql,
        container.id,
      );
    expect(persisted?.pullContinuation).toEqual(rejectedContinuation);
    expect(persisted?.pullContinuationRecoveryRequired).toBeUndefined();
    expect(metadataState.pullContinuation).toEqual(rejectedContinuation);
  } finally {
    database.close();
  }
});

test("malformed metadata progress survives restart until a page-one settlement", async () => {
  const { close, execSql } = await createTestExecSql(
    "metadata-pull-continuation-malformed-restart",
  );
  const container = createContainerRecord({
    id: "container-1",
    metadataDocumentId: "metadata-document-1",
    parentId: null,
  });
  const record = createDocumentRecord({
    contentKeyBundle: "content-key",
    documentId: "metadata-document-1",
    documentKekTargets: "targets",
    documentManifestBundle: "manifest",
    id: container.id,
    lastCommitLsn: "0/2",
  });
  try {
    await sqlContainerContentsPersistence.ensureSchema(execSql);
    await sqlContainerContentsPersistence.saveContainer(
      execSql,
      container,
      record,
    );
    await execSql(
      "UPDATE documents SET pull_continuation = :cursor WHERE app_kind = 'container-metadata' AND local_id = :localId",
      { ":cursor": "not-json", ":localId": container.id },
    );

    const restarted =
      await sqlContainerContentsPersistence.loadContainerMetadataRecord(
        execSql,
        container.id,
      );
    expect(restarted?.pullContinuationRecoveryRequired).toBe(true);
    if (!restarted) throw new Error("Expected restarted metadata state");

    await sqlContainerContentsPersistence.saveContainer(execSql, container, {
      ...restarted,
      lastCommitLsn: "0/2",
    });
    expect(
      await execSql(
        "SELECT pull_continuation FROM documents WHERE app_kind = 'container-metadata' AND local_id = :localId",
        { ":localId": container.id },
      ),
    ).toEqual([{ pull_continuation: "not-json" }]);

    await sqlContainerContentsPersistence.saveContainer(execSql, container, {
      ...restarted,
      pullContinuation: null,
    });
    expect(
      await execSql(
        "SELECT pull_continuation FROM documents WHERE app_kind = 'container-metadata' AND local_id = :localId",
        { ":localId": container.id },
      ),
    ).toEqual([{ pull_continuation: null }]);
  } finally {
    close();
  }
});
