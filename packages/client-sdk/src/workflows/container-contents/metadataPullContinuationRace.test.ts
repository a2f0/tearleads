import { expect, test } from "bun:test";
import { base64ToBytes, bytesToBase64 } from "@symcrypt/encoding";
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
import { runSerializedSqlMutation } from "../../data/sqlite/sqlSchema";
import { enqueuePendingContainerUpdate } from "./containerPersistence";
import {
  createContainerRecord,
  createDocumentRecord,
} from "./metadata.testFixtures";
import {
  persistContainerMetadataStateFromRuntime,
  renameContainerMetadataStateFromRuntime,
} from "./metadataPersistence";

test("a queued metadata edit rebases onto a replacement security identity", async () => {
  const { close, execSql } = await createTestExecSql(
    "metadata-local-edit-identity-race",
  );
  const staleContainer = createContainerRecord({
    id: "container-1",
    metadataDocumentId: "metadata-document-old",
    parentId: null,
  });
  const durableContainer = {
    ...staleContainer,
    metadataDocumentId: "metadata-document-new",
  };
  const staleRecord = createDocumentRecord({
    accessStateHash: "access-old",
    documentId: "metadata-document-old",
    id: staleContainer.id,
  });
  try {
    const staleDoc = await createDocument("metadata-local-edit-stale");
    writeContainerMetadataValue(staleDoc, { icon: null, name: "Stale" });
    const durableDoc = await createDocument("metadata-local-edit-durable");
    writeContainerMetadataValue(durableDoc, {
      icon: "cloud",
      name: "Durable name",
    });
    const durableRecord = createDocumentRecord({
      accessEpoch: 2,
      accessStateHash: "access-new",
      contentKeyBundle: "content-key-new",
      documentId: "metadata-document-new",
      documentKekTargets: "targets-new",
      documentManifestBundle: "manifest-new",
      id: staleContainer.id,
      metadataUpdates: bytesToBase64(exportAllUpdates(durableDoc)),
    });
    await sqlContainerContentsPersistence.ensureSchema(execSql);
    await sqlContainerContentsPersistence.saveContainer(
      execSql,
      durableContainer,
      durableRecord,
    );

    const metadataState = {
      container: staleContainer,
      doc: staleDoc,
      record: staleRecord,
    };
    const renamed = await renameContainerMetadataStateFromRuntime({
      metadataState,
      name: "Local rename",
      persistence: sqlContainerContentsPersistence,
      runtime: { infra: { execSql } },
    });

    expect(renamed).not.toBeNull();
    expect(renamed?.record).toMatchObject({
      accessEpoch: 2,
      accessStateHash: "access-new",
      contentKeyBundle: "content-key-new",
      documentId: "metadata-document-new",
      documentKekTargets: "targets-new",
      documentManifestBundle: "manifest-new",
    });
    expect(readContainerMetadataValue(metadataState.doc, "/")).toEqual({
      icon: "cloud",
      name: "Local rename",
    });
    expect(
      await sqlContainerContentsPersistence.listPendingUpdates(
        execSql,
        staleContainer.id,
      ),
    ).toHaveLength(1);
  } finally {
    close();
  }
});

test("a queued metadata save preserves pull progress advanced ahead of it", async () => {
  const { close, execSql } = await createTestExecSql(
    "metadata-pull-continuation-save-race",
  );
  const container = createContainerRecord({
    id: "container-1",
    metadataDocumentId: "metadata-document-1",
    parentId: null,
  });
  const staleRecord = createDocumentRecord({
    documentId: "metadata-document-1",
    id: container.id,
    pullContinuation: {
      commitLsn: "0/2",
      commitLsnMode: "tracked",
      cursor: "metadata-page-2",
    },
  });
  const advancedContinuation = {
    commitLsn: "0/3",
    commitLsnMode: "tracked" as const,
    cursor: "metadata-page-3",
  };

  try {
    const baseDoc = await createDocument("metadata-page-base");
    writeContainerMetadataValue(baseDoc, { icon: null, name: "Before race" });
    const baseSnapshot = exportAllUpdates(baseDoc);
    const localDoc = await createDocument("metadata-page-local");
    importUpdates(localDoc, [baseSnapshot]);
    localDoc.getMap("container").set("name", "Renamed while page settles");
    const remotePageDoc = await createDocument("metadata-page-remote");
    importUpdates(remotePageDoc, [baseSnapshot]);
    remotePageDoc.getMap("container").set("icon", "cloud");
    staleRecord.metadataUpdates = bytesToBase64(baseSnapshot);

    await sqlContainerContentsPersistence.ensureSchema(execSql);
    await sqlContainerContentsPersistence.saveContainer(
      execSql,
      container,
      staleRecord,
    );
    let releaseMutation = () => {};
    const mutationBlocked = new Promise<void>((resolve) => {
      releaseMutation = resolve;
    });
    const blocker = runSerializedSqlMutation(execSql, () => mutationBlocked);
    const pageSave = sqlContainerContentsPersistence.saveContainer(
      execSql,
      container,
      {
        ...staleRecord,
        metadataUpdates: bytesToBase64(exportAllUpdates(remotePageDoc)),
        pullContinuation: advancedContinuation,
      },
    );
    const queuedMetadataSave = persistContainerMetadataStateFromRuntime({
      metadataState: { container, doc: localDoc, record: staleRecord },
      patch: { name: "Renamed while the page settles" },
      persistence: sqlContainerContentsPersistence,
      runtime: { infra: { execSql } },
    });

    releaseMutation();
    await Promise.all([blocker, pageSave, queuedMetadataSave]);

    const persisted =
      await sqlContainerContentsPersistence.loadContainerMetadataRecord(
        execSql,
        container.id,
      );
    expect(persisted?.pullContinuation).toEqual(advancedContinuation);
    if (!persisted) throw new Error("Expected persisted metadata state");
    const restoredDoc = await createDocument("metadata-page-restored");
    importUpdates(restoredDoc, [base64ToBytes(persisted.metadataUpdates)]);
    expect(readContainerMetadataValue(restoredDoc, "/")).toEqual({
      icon: "cloud",
      name: "Renamed while page settles",
    });
  } finally {
    close();
  }
});

test("an out-of-order metadata page cannot replace a later pane's progress", async () => {
  const { close, execSql } = await createTestExecSql(
    "metadata-pull-continuation-page-race",
  );
  const container = createContainerRecord({
    id: "container-1",
    metadataDocumentId: "metadata-document-1",
    parentId: null,
  });
  const consumedContinuation = {
    commitLsn: "0/2",
    commitLsnMode: "tracked" as const,
    cursor: "metadata-page-2",
  };
  const staleRecord = createDocumentRecord({
    documentId: "metadata-document-1",
    id: container.id,
    lastCommitLsn: "0/2",
    pullContinuation: consumedContinuation,
  });
  const staleNextContinuation = {
    commitLsn: "0/3",
    commitLsnMode: "tracked" as const,
    cursor: "metadata-page-3",
  };
  const durableNextContinuation = {
    commitLsn: "0/4",
    commitLsnMode: "tracked" as const,
    cursor: "metadata-page-4",
  };

  try {
    const baseDoc = await createDocument("metadata-page-shared-base");
    writeContainerMetadataValue(baseDoc, {
      icon: null,
      name: "Before concurrent pages",
    });
    const baseUpdates = exportAllUpdates(baseDoc);
    const stalePageDoc = await createDocument("metadata-page-stale-pane");
    importUpdates(stalePageDoc, [baseUpdates]);
    stalePageDoc.getMap("container").set("name", "Rejected page three");
    const laterPageDoc = await createDocument("metadata-page-later-pane");
    importUpdates(laterPageDoc, [baseUpdates]);
    laterPageDoc.getMap("container").set("icon", "cloud");

    await sqlContainerContentsPersistence.ensureSchema(execSql);
    await sqlContainerContentsPersistence.saveContainer(execSql, container, {
      ...staleRecord,
      lastCommitLsn: "0/4",
      metadataUpdates: bytesToBase64(exportAllUpdates(laterPageDoc)),
      pullContinuation: durableNextContinuation,
    });
    const acceptedUpdateId = await enqueuePendingContainerUpdate(
      execSql,
      sqlContainerContentsPersistence,
      { containerId: container.id, update: exportAllUpdates(laterPageDoc) },
    );
    if (!acceptedUpdateId) throw new Error("Expected pending metadata update");

    const metadataState = {
      container,
      doc: stalePageDoc,
      record: staleRecord,
    };
    const settled = await persistContainerMetadataStateFromRuntime({
      acceptedPendingUpdateIds: [acceptedUpdateId],
      expectedSyncState: {
        pullContinuation: consumedContinuation,
        record: staleRecord,
      },
      metadataState,
      patch: {
        lastCommitLsn: "0/3",
        pullContinuation: staleNextContinuation,
      },
      persistence: sqlContainerContentsPersistence,
      runtime: { infra: { execSql } },
    });
    if (!settled) throw new Error("Expected authoritative metadata state");

    expect(settled.pullContinuationSuperseded).toBe(true);
    expect(settled.record).toMatchObject({
      lastCommitLsn: "0/4",
      pullContinuation: durableNextContinuation,
    });
    expect(
      await sqlContainerContentsPersistence.listPendingUpdates(
        execSql,
        container.id,
      ),
    ).toEqual([]);
    expect(readContainerMetadataValue(metadataState.doc, "/")).toEqual({
      icon: "cloud",
      name: "Before concurrent pages",
    });
  } finally {
    close();
  }
});

test("a metadata page-one response cannot restore a replaced key context", async () => {
  const { close, execSql } = await createTestExecSql(
    "metadata-pull-page-one-identity-race",
  );
  const staleContainer = createContainerRecord({
    id: "container-1",
    metadataDocumentId: "metadata-document-old",
    parentId: null,
  });
  const durableContainer = {
    ...staleContainer,
    metadataDocumentId: "metadata-document-new",
    name: "Durable container",
  };
  const staleRecord = createDocumentRecord({
    accessStateHash: "access-old",
    contentKeyBundle: "content-key-old",
    documentId: "metadata-document-old",
    documentKekTargets: "targets-old",
    documentManifestBundle: "manifest-old",
    id: staleContainer.id,
    lastCommitLsn: "0/2",
  });
  try {
    const staleDoc = await createDocument("metadata-page-one-stale");
    writeContainerMetadataValue(staleDoc, { icon: null, name: "Stale" });
    const durableDoc = await createDocument("metadata-page-one-durable");
    writeContainerMetadataValue(durableDoc, {
      icon: "cloud",
      name: "Durable container",
    });
    const durableRecord = createDocumentRecord({
      ...staleRecord,
      accessEpoch: 2,
      accessStateHash: "access-new",
      contentKeyBundle: "content-key-new",
      documentId: "metadata-document-new",
      documentKekTargets: "targets-new",
      documentManifestBundle: "manifest-new",
      lastCommitLsn: "0/4",
      metadataUpdates: bytesToBase64(exportAllUpdates(durableDoc)),
    });
    await sqlContainerContentsPersistence.ensureSchema(execSql);
    await sqlContainerContentsPersistence.saveContainer(
      execSql,
      durableContainer,
      durableRecord,
    );

    const settled = await persistContainerMetadataStateFromRuntime({
      expectedSyncState: { pullContinuation: null, record: staleRecord },
      metadataState: {
        container: staleContainer,
        doc: staleDoc,
        record: staleRecord,
      },
      patch: {
        accessStateHash: "access-old-response",
        lastCommitLsn: "0/3",
        pullContinuation: null,
      },
      persistence: sqlContainerContentsPersistence,
      runtime: { infra: { execSql } },
    });
    if (!settled) throw new Error("Expected authoritative metadata state");

    expect(settled.pullContinuationSuperseded).toBe(true);
    expect(settled.record).toMatchObject({
      accessEpoch: 2,
      accessStateHash: "access-new",
      contentKeyBundle: "content-key-new",
      documentId: "metadata-document-new",
      documentKekTargets: "targets-new",
      documentManifestBundle: "manifest-new",
      lastCommitLsn: "0/4",
      metadataUpdates: durableRecord.metadataUpdates,
    });
    expect(
      await sqlContainerContentsPersistence.loadContainerMetadataRecord(
        execSql,
        staleContainer.id,
      ),
    ).toMatchObject({
      accessEpoch: 2,
      accessStateHash: "access-new",
      contentKeyBundle: "content-key-new",
      documentId: "metadata-document-new",
      documentKekTargets: "targets-new",
      documentManifestBundle: "manifest-new",
      lastCommitLsn: "0/4",
      metadataUpdates: durableRecord.metadataUpdates,
    });
    expect(
      (await sqlContainerContentsPersistence.loadContainers(execSql))[0]
        ?.container,
    ).toMatchObject(durableContainer);
  } finally {
    close();
  }
});

test("a metadata settlement reports deletion instead of resurrecting stale state", async () => {
  const { close, execSql } = await createTestExecSql(
    "metadata-settlement-deletion-race",
  );
  const container = createContainerRecord({
    id: "container-1",
    metadataDocumentId: "metadata-document-1",
    parentId: null,
  });
  const record = createDocumentRecord({
    documentId: "metadata-document-1",
    id: container.id,
    lastCommitLsn: "0/2",
  });
  try {
    const doc = await createDocument("metadata-deleted-settlement");
    writeContainerMetadataValue(doc, { icon: null, name: "Deleted" });
    record.metadataUpdates = bytesToBase64(exportAllUpdates(doc));
    await sqlContainerContentsPersistence.ensureSchema(execSql);
    await sqlContainerContentsPersistence.saveContainer(
      execSql,
      container,
      record,
    );
    await sqlContainerContentsPersistence.deleteContainer(
      execSql,
      container.id,
    );

    const renamed = await renameContainerMetadataStateFromRuntime({
      metadataState: { container, doc, record },
      name: "Must not resurrect",
      persistence: sqlContainerContentsPersistence,
      runtime: { infra: { execSql } },
    });
    expect(renamed).toBeNull();

    const settled = await persistContainerMetadataStateFromRuntime({
      expectedSyncState: { pullContinuation: null, record },
      metadataState: { container, doc, record },
      patch: { lastCommitLsn: "0/3", pullContinuation: null },
      persistence: sqlContainerContentsPersistence,
      runtime: { infra: { execSql } },
    });

    expect(settled).toBeNull();
    expect(
      await sqlContainerContentsPersistence.loadContainers(execSql),
    ).toEqual([]);
  } finally {
    close();
  }
});
