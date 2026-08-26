import { expect, test } from "bun:test";
import { bytesToBase64 } from "@symcrypt/encoding";
import {
  createDocument,
  encodeVersionVector,
  exportFullHistorySnapshot,
} from "@symcrypt/loro";
import { openSharedDocumentPersistenceConnections } from "../../../../test/helpers/sharedDocumentPersistence";
import { sqlDocumentsPersistence } from "./documentsPersistence";
import { loadStoredDocumentWithHistoryRestoreState } from "./internal/documentHistoryStatePersistence";
import { loadStoredDocumentStoreState } from "./internal/documentStoreStatePersistence";

async function createHistoryStates() {
  const document = await createDocument("document-concurrency-history");
  document.getText("text").update("original");
  const original = {
    snapshot: bytesToBase64(exportFullHistorySnapshot(document)),
    version: encodeVersionVector(document),
  };
  document.getText("text").update("replacement");
  return {
    original,
    replacement: {
      snapshot: bytesToBase64(exportFullHistorySnapshot(document)),
      version: encodeVersionVector(document),
    },
  };
}

test("two pane document mutations settle as commit and CAS loss", async () => {
  const { close, first, second } =
    await openSharedDocumentPersistenceConnections("document-cas-race");
  const base = {
    accessEpoch: 1,
    containerId: "container",
    documentId: "document",
    id: "local-document",
    snapshotEndVersion: "base-version",
    text: "base",
  };
  try {
    await sqlDocumentsPersistence.saveDocument(first.runtime.execSql, base);
    const expectedRecord = await sqlDocumentsPersistence.loadDocument(
      first.runtime.execSql,
      base.id,
    );
    if (!expectedRecord) throw new Error("Expected the base document");
    const mutate = (text: string, execSql: typeof first.runtime.execSql) =>
      sqlDocumentsPersistence.commitDocumentMutation(
        execSql,
        {
          acceptedPendingUpdateIds: [],
          document: {
            ...expectedRecord,
            snapshotEndVersion: `${text}-version`,
            text,
          },
          expectedRecord,
          settleAcceptedPendingOnConflict: false,
        },
        async () => undefined,
      );

    const results = await Promise.all([
      mutate("first", first.runtime.execSql),
      mutate("second", second.runtime.execSql),
    ]);
    expect(results.filter(({ committed }) => committed)).toHaveLength(1);
    expect(results.filter(({ committed }) => !committed)).toHaveLength(1);
  } finally {
    close();
  }
});

test("two pane document creators return one winner and one null", async () => {
  const { close, first, second } =
    await openSharedDocumentPersistenceConnections("document-create-race");
  const document = {
    accessEpoch: 1,
    containerId: "container",
    documentId: null,
    id: "local-document",
    snapshotEndVersion: "birth-version",
    text: "birth",
  };
  const create = (execSql: typeof first.runtime.execSql) =>
    sqlDocumentsPersistence.createDocumentWithHistoryCheckpoint(
      execSql,
      document,
      { endVersionVector: "birth-version", snapshot: "snapshot" },
      undefined,
      async () => undefined,
    );
  try {
    const results = await Promise.all([
      create(first.runtime.execSql),
      create(second.runtime.execSql),
    ]);
    expect(results.filter((result) => result !== null)).toHaveLength(1);
    expect(results.filter((result) => result === null)).toHaveLength(1);
  } finally {
    close();
  }
});

test("record and history reads cannot tear across a replacement commit", async () => {
  const { close, first, second } =
    await openSharedDocumentPersistenceConnections("document-read-race");
  const history = await createHistoryStates();
  const original = {
    accessEpoch: 1,
    containerId: "container",
    documentId: "original-document",
    id: "local-document",
    snapshotEndVersion: history.original.version,
    text: "original",
  };
  let replacement: Promise<unknown> = Promise.resolve();
  try {
    await sqlDocumentsPersistence.createDocumentWithHistoryCheckpoint(
      first.runtime.execSql,
      original,
      {
        endVersionVector: history.original.version,
        snapshot: history.original.snapshot,
      },
      undefined,
      async () => undefined,
    );
    const expectedRecord = await sqlDocumentsPersistence.loadDocument(
      first.runtime.execSql,
      original.id,
    );
    if (!expectedRecord) throw new Error("Expected the original document");

    const loaded = await loadStoredDocumentWithHistoryRestoreState(
      first.runtime.execSql,
      original.id,
      {
        loadDocument: async (execSql, localId) => {
          const record = await sqlDocumentsPersistence.loadDocument(
            execSql,
            localId,
          );
          replacement = sqlDocumentsPersistence.commitDocumentMutation(
            second.runtime.execSql,
            {
              acceptedPendingUpdateIds: [],
              document: {
                ...expectedRecord,
                accessEpoch: 2,
                documentId: "replacement-document",
                snapshotEndVersion: history.replacement.version,
                text: "replacement",
              },
              expectedRecord,
              historyCheckpoint: {
                coveredTailIds: [],
                endVersionVector: history.replacement.version,
                pruneCoveredLocalState: false,
                snapshot: history.replacement.snapshot,
              },
              settleAcceptedPendingOnConflict: false,
            },
            async () => undefined,
          );
          await Promise.resolve();
          return record;
        },
        loadHistoryRestoreState:
          sqlDocumentsPersistence.loadHistoryRestoreState,
      },
    );
    expect(loaded.document?.documentId).toBe("original-document");
    expect(loaded.historyRestoreState?.snapshot).toBe(
      history.original.snapshot,
    );

    await replacement;
    await expect(
      sqlDocumentsPersistence.loadDocumentWithHistoryRestoreState(
        first.runtime.execSql,
        original.id,
      ),
    ).resolves.toMatchObject({
      document: { documentId: "replacement-document" },
      historyRestoreState: { snapshot: history.replacement.snapshot },
    });
  } finally {
    await replacement.catch(() => undefined);
    close();
  }
});

test("startup record, history, and attachments share one database snapshot", async () => {
  const { close, first, second } =
    await openSharedDocumentPersistenceConnections(
      "document-startup-state-race",
    );
  const history = await createHistoryStates();
  const original = {
    accessEpoch: 1,
    containerId: "container",
    documentId: "original-document",
    id: "local-document",
    snapshotEndVersion: history.original.version,
    text: "original",
  };
  const oldLocalAttachment = {
    blobId: "old-blob",
    byteLength: 3,
    detachedAt: null,
    localId: original.id,
    mimeType: "text/plain",
    slotId: "slot",
    storageKey: "old-local-key",
  };
  const oldPendingAttachment = {
    byteLength: 3,
    localId: original.id,
    mimeType: "text/plain",
    name: "old.txt",
    slotId: "slot",
    storageKey: "old-pending-key",
    upload: null,
  };
  let replacement: Promise<void> = Promise.resolve();
  try {
    await sqlDocumentsPersistence.createDocumentWithHistoryCheckpoint(
      first.runtime.execSql,
      original,
      {
        endVersionVector: history.original.version,
        snapshot: history.original.snapshot,
      },
      undefined,
      async () => undefined,
    );
    await sqlDocumentsPersistence.saveLocalAttachment(
      first.runtime.execSql,
      oldLocalAttachment,
    );
    await sqlDocumentsPersistence.savePendingAttachment(
      first.runtime.execSql,
      oldPendingAttachment,
    );
    const expectedRecord = await sqlDocumentsPersistence.loadDocument(
      first.runtime.execSql,
      original.id,
    );
    if (!expectedRecord) throw new Error("Expected the original document");

    const loaded = await loadStoredDocumentStoreState(
      first.runtime.execSql,
      original.id,
      {
        ...sqlDocumentsPersistence,
        loadDocument: async (execSql, localId) => {
          const record = await sqlDocumentsPersistence.loadDocument(
            execSql,
            localId,
          );
          replacement = (async () => {
            await sqlDocumentsPersistence.commitDocumentMutation(
              second.runtime.execSql,
              {
                acceptedPendingUpdateIds: [],
                document: {
                  ...expectedRecord,
                  accessEpoch: 2,
                  documentId: "replacement-document",
                  snapshotEndVersion: history.replacement.version,
                  text: "replacement",
                },
                expectedRecord,
                historyCheckpoint: {
                  coveredTailIds: [],
                  endVersionVector: history.replacement.version,
                  pruneCoveredLocalState: false,
                  snapshot: history.replacement.snapshot,
                },
                settleAcceptedPendingOnConflict: false,
              },
              async () => undefined,
            );
            await sqlDocumentsPersistence.deleteLocalAttachment(
              second.runtime.execSql,
              original.id,
              oldLocalAttachment.slotId,
              oldLocalAttachment.storageKey,
            );
            await sqlDocumentsPersistence.deletePendingAttachment(
              second.runtime.execSql,
              original.id,
              oldPendingAttachment.slotId,
              oldPendingAttachment.storageKey,
            );
          })();
          await Promise.resolve();
          return record;
        },
      },
    );

    expect(loaded.document?.documentId).toBe("original-document");
    expect(loaded.historyRestoreState?.snapshot).toBe(
      history.original.snapshot,
    );
    expect(loaded.localAttachments).toEqual([oldLocalAttachment]);
    expect(loaded.pendingAttachments).toEqual([oldPendingAttachment]);
    await replacement;
    await expect(
      sqlDocumentsPersistence.loadDocumentStoreState(
        first.runtime.execSql,
        original.id,
      ),
    ).resolves.toMatchObject({
      document: { documentId: "replacement-document" },
      historyRestoreState: { snapshot: history.replacement.snapshot },
      localAttachments: [],
      pendingAttachments: [],
    });
  } finally {
    await replacement.catch(() => undefined);
    close();
  }
});

test("pull invalidation returns one identity-aligned record and history snapshot", async () => {
  const { close, first, second } =
    await openSharedDocumentPersistenceConnections(
      "document-invalidation-race",
    );
  const history = await createHistoryStates();
  const continuation = {
    commitLsn: "0/2",
    commitLsnMode: "tracked" as const,
    cursor: "page-2",
  };
  const original = {
    accessEpoch: 1,
    containerId: "container",
    documentId: "original-document",
    id: "local-document",
    pullContinuation: continuation,
    snapshotEndVersion: history.original.version,
    text: "original",
  };
  try {
    await sqlDocumentsPersistence.createDocumentWithHistoryCheckpoint(
      first.runtime.execSql,
      original,
      {
        endVersionVector: history.original.version,
        snapshot: history.original.snapshot,
      },
      undefined,
      async () => undefined,
    );
    const expectedRecord = await sqlDocumentsPersistence.loadDocument(
      first.runtime.execSql,
      original.id,
    );
    if (!expectedRecord) throw new Error("Expected the original document");

    const [invalidated] = await Promise.all([
      sqlDocumentsPersistence.invalidatePullContinuation(
        first.runtime.execSql,
        {
          accessEpoch: original.accessEpoch,
          accessStateHash: null,
          continuation,
          contentKeyBundle: null,
          documentId: original.documentId,
          documentKekTargets: null,
          documentManifestBundle: null,
          lastCommitLsn: null,
          localId: original.id,
        },
      ),
      sqlDocumentsPersistence.commitDocumentMutation(
        second.runtime.execSql,
        {
          acceptedPendingUpdateIds: [],
          document: {
            ...expectedRecord,
            accessEpoch: 2,
            documentId: "replacement-document",
            pullContinuation: null,
            snapshotEndVersion: history.replacement.version,
            text: "replacement",
          },
          expectedRecord,
          historyCheckpoint: {
            coveredTailIds: [],
            endVersionVector: history.replacement.version,
            pruneCoveredLocalState: false,
            snapshot: history.replacement.snapshot,
          },
          settleAcceptedPendingOnConflict: false,
        },
        async () => undefined,
      ),
    ]);
    if (!invalidated) throw new Error("Expected an authoritative document");
    const identityAndSnapshot = JSON.stringify([
      invalidated.record.documentId,
      invalidated.historyRestoreState?.snapshot ?? null,
    ]);
    expect(
      new Set([
        JSON.stringify(["original-document", history.original.snapshot]),
        JSON.stringify(["replacement-document", history.replacement.snapshot]),
      ]).has(identityAndSnapshot),
    ).toBe(true);
  } finally {
    close();
  }
});
