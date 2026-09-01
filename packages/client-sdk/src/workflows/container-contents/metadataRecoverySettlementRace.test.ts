import { expect, test } from "bun:test";
import { bytesToBase64 } from "@tearleads/encoding";
import { createDocument, exportAllUpdates } from "@tearleads/loro";
import { createTestExecSql } from "@tearleads/test-utils";
import { writeContainerMetadataValue } from "../../data/containers/containerMetadataDocument";
import { sqlContainerContentsPersistence } from "../../data/persistence/container-contents/containerContentsPersistence";
import {
  createContainerRecord,
  createDocumentRecord,
} from "./metadata.testFixtures";
import { persistContainerMetadataStateFromRuntime } from "./metadataPersistence";

test("a stale recovery pane cannot restore an intermediate metadata cursor", async () => {
  const { close, execSql } = await createTestExecSql(
    "metadata-recovery-settlement-race",
  );
  const container = createContainerRecord({
    id: "container-1",
    metadataDocumentId: "metadata-document-1",
    parentId: null,
  });
  try {
    const document = await createDocument("metadata-recovery-stale-pane");
    writeContainerMetadataValue(document, {
      icon: null,
      name: "Recovered container",
    });
    const staleRecoveryRecord = createDocumentRecord({
      documentId: "metadata-document-1",
      id: container.id,
      lastCommitLsn: "0/2",
      metadataUpdates: bytesToBase64(exportAllUpdates(document)),
      pullContinuationRecoveryRequired: true,
    });
    const {
      pullContinuationRecoveryRequired: _completedRecovery,
      ...completedRecoveryRecord
    } = staleRecoveryRecord;
    await sqlContainerContentsPersistence.ensureSchema(execSql);
    await sqlContainerContentsPersistence.saveContainer(
      execSql,
      container,
      completedRecoveryRecord,
    );
    const staleIntermediateContinuation = {
      commitLsn: "0/3",
      commitLsnMode: "tracked" as const,
      cursor: "stale-metadata-recovery-page-2",
    };

    const settled = await persistContainerMetadataStateFromRuntime({
      expectedSyncState: {
        pullContinuation: null,
        record: staleRecoveryRecord,
      },
      metadataState: {
        container,
        doc: document,
        record: staleRecoveryRecord,
      },
      patch: {
        lastCommitLsn: "0/3",
        pullContinuation: staleIntermediateContinuation,
      },
      persistence: sqlContainerContentsPersistence,
      runtime: { infra: { execSql } },
    });
    if (!settled) throw new Error("Expected authoritative metadata state");

    expect(settled.pullContinuationSuperseded).toBe(true);
    expect(settled.record.lastCommitLsn).toBe("0/2");
    expect(settled.record.pullContinuation).toBeUndefined();
    expect(settled.record.pullContinuationRecoveryRequired).toBeUndefined();
    const restarted =
      await sqlContainerContentsPersistence.loadContainerMetadataRecord(
        execSql,
        container.id,
      );
    expect(restarted?.lastCommitLsn).toBe("0/2");
    expect(restarted?.pullContinuation).toBeUndefined();
    expect(restarted?.pullContinuationRecoveryRequired).toBeUndefined();
  } finally {
    close();
  }
});
