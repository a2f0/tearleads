import { expect, test } from "bun:test";
import { bytesToBase64 } from "@symcrypt/encoding";
import {
  createDocument,
  exportAllUpdates,
  importUpdates,
} from "@symcrypt/loro";
import { createTestExecSql } from "@symcrypt/test-utils";
import {
  readContainerMetadataValue,
  writeContainerMetadataValue,
} from "../../data/containers/containerMetadataDocument";
import { sqlContainerContentsPersistence } from "../../data/persistence/container-contents/containerContentsPersistence";
import { enqueuePendingContainerUpdate } from "./containerPersistence";
import {
  createContainerRecord,
  createDocumentRecord,
} from "./metadata.testFixtures";
import { persistContainerMetadataStateFromRuntime } from "./metadataPersistence";

test("a metadata response merges a raced local edit and settles its accepted update", async () => {
  const { close, execSql } = await createTestExecSql(
    "metadata-local-edit-race",
  );
  const container = createContainerRecord({
    id: "container-1",
    metadataDocumentId: "metadata-document-1",
    parentId: null,
  });
  const continuation = {
    commitLsn: "0/2",
    commitLsnMode: "tracked" as const,
    cursor: "metadata-page-2",
  };
  try {
    const baseDoc = await createDocument("metadata-local-race-base");
    writeContainerMetadataValue(baseDoc, { icon: null, name: "Before edit" });
    const baseUpdates = exportAllUpdates(baseDoc);
    const staleResponseDoc = await createDocument("metadata-race-response");
    importUpdates(staleResponseDoc, [baseUpdates]);
    staleResponseDoc.getMap("container").set("icon", "cloud");
    const localDoc = await createDocument("metadata-local-race-winner");
    importUpdates(localDoc, [baseUpdates]);
    localDoc.getMap("container").set("name", "Local winner");
    const staleRecord = createDocumentRecord({
      documentId: "metadata-document-1",
      id: container.id,
      lastCommitLsn: "0/2",
      metadataUpdates: bytesToBase64(baseUpdates),
      pullContinuation: continuation,
    });
    const durableRecord = {
      ...staleRecord,
      metadataUpdates: bytesToBase64(exportAllUpdates(localDoc)),
    };
    await sqlContainerContentsPersistence.ensureSchema(execSql);
    await sqlContainerContentsPersistence.saveContainer(
      execSql,
      { ...container, name: "Local winner" },
      durableRecord,
    );
    const acceptedUpdateId = await enqueuePendingContainerUpdate(
      execSql,
      sqlContainerContentsPersistence,
      { containerId: container.id, update: exportAllUpdates(localDoc) },
    );
    if (!acceptedUpdateId) throw new Error("Expected pending metadata update");

    const metadataState = {
      container,
      doc: staleResponseDoc,
      record: staleRecord,
    };
    const settled = await persistContainerMetadataStateFromRuntime({
      acceptedPendingUpdateIds: [acceptedUpdateId],
      expectedSyncState: {
        pullContinuation: continuation,
        record: staleRecord,
      },
      metadataState,
      patch: {
        lastCommitLsn: "0/3",
        pullContinuation: null,
      },
      persistence: sqlContainerContentsPersistence,
      runtime: { infra: { execSql } },
    });
    if (!settled) throw new Error("Expected authoritative metadata state");

    expect(settled.pullContinuationSuperseded).toBeUndefined();
    expect(settled.record.lastCommitLsn).toBe("0/3");
    expect(
      await sqlContainerContentsPersistence.listPendingUpdates(
        execSql,
        container.id,
      ),
    ).toEqual([]);
    expect(readContainerMetadataValue(metadataState.doc, "/")).toEqual({
      icon: "cloud",
      name: "Local winner",
    });
  } finally {
    close();
  }
});
