import { expect, test } from "bun:test";
import { createTestExecSql } from "@symcrypt/test-utils";
import { sqlDocumentsPersistence } from "../../../data/persistence/documents/documentsPersistence";
import {
  createRemoteHistoryFixture,
  noopDocumentStorePersistenceEffects,
} from "./documentStore.testFixtures";
import {
  ensureDocumentStoreReady,
  relinkDocumentStore,
} from "./initialization";
import {
  createRotationRecoveryRuntime,
  persistFullHistoryDocument,
} from "./rotationRecoveryHelpers.test";
import { createDocumentStoreState, resetDocumentStore } from "./state";
import {
  allowDocumentStoreRemoteSync,
  captureDocumentStoreRemoteSyncRequestGeneration,
  isDocumentStoreRemoteSyncBlocked,
  isDocumentStoreRemoteSyncRequestGenerationCurrent,
} from "./syncGeneration";

test("queued A to B to A relinks invalidate both live identity transitions", async () => {
  const { close, execSql } = await createTestExecSql(
    "queued-relink-generation",
  );
  let releaseSecondCommit: () => void = () => undefined;
  const secondCommitGate = new Promise<void>((resolve) => {
    releaseSecondCommit = resolve;
  });
  let markSecondCommitStarted: () => void = () => undefined;
  const secondCommitStarted = new Promise<void>((resolve) => {
    markSecondCommitStarted = resolve;
  });
  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    const fixture = await createRemoteHistoryFixture();
    const localId = "queued-relink-generation-local";
    await persistFullHistoryDocument({
      doc: fixture.remoteDocument,
      documentId: fixture.writerProjection.documentId,
      execSql,
      localId,
    });
    let commitCount = 0;
    const gatedPersistence: typeof sqlDocumentsPersistence = {
      ...sqlDocumentsPersistence,
      async commitDocumentMutation(...args) {
        commitCount += 1;
        if (commitCount === 2) {
          markSecondCommitStarted();
          await secondCommitGate;
        }
        return sqlDocumentsPersistence.commitDocumentMutation(...args);
      },
    };
    const state = createDocumentStoreState(
      localId,
      createRotationRecoveryRuntime({ execSql, fixture }),
      gatedPersistence,
      noopDocumentStorePersistenceEffects,
      fixture.writerProjection.documentId,
    );
    expect(await ensureDocumentStoreReady(state, () => undefined)).toBe(true);

    const relinkToB = relinkDocumentStore(
      state,
      {
        accessEpoch: 2,
        containerId: "container-b",
        documentId: "document-b",
        localId,
      },
      () => undefined,
    );
    const relinkBackToA = relinkDocumentStore(
      state,
      {
        accessEpoch: 3,
        containerId: fixture.projection.containerId,
        documentId: fixture.writerProjection.documentId,
        localId,
      },
      () => undefined,
    );
    await secondCommitStarted;
    expect(await relinkToB).not.toBeNull();

    allowDocumentStoreRemoteSync(state);
    const generationWhileB =
      captureDocumentStoreRemoteSyncRequestGeneration(state);
    releaseSecondCommit();
    expect(await relinkBackToA).not.toBeNull();

    expect(state.record?.documentId).toBe(fixture.writerProjection.documentId);
    expect(isDocumentStoreRemoteSyncBlocked(state)).toBe(true);
    expect(
      isDocumentStoreRemoteSyncRequestGenerationCurrent(
        state,
        generationWhileB,
      ),
    ).toBe(false);
  } finally {
    releaseSecondCommit();
    close();
  }
});

test("a reset during relink cannot restore the stale document generation", async () => {
  const { close, execSql } = await createTestExecSql("relink-reset-generation");
  let releasePersist: () => void = () => undefined;
  const persistGate = new Promise<void>((resolve) => {
    releasePersist = resolve;
  });
  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    const fixture = await createRemoteHistoryFixture();
    const localId = "relink-reset-generation-local";
    await persistFullHistoryDocument({
      doc: fixture.remoteDocument,
      documentId: fixture.writerProjection.documentId,
      execSql,
      localId,
    });
    const state = createDocumentStoreState(
      localId,
      createRotationRecoveryRuntime({ execSql, fixture }),
      sqlDocumentsPersistence,
      noopDocumentStorePersistenceEffects,
      fixture.writerProjection.documentId,
    );
    expect(await ensureDocumentStoreReady(state, () => undefined)).toBe(true);
    const originalDurable = await sqlDocumentsPersistence.loadDocument(
      execSql,
      localId,
    );
    expect(originalDurable).not.toBeNull();
    const persistence = state.persistence;
    let signalPersistStarted: () => void = () => undefined;
    const persistStarted = new Promise<void>((resolve) => {
      signalPersistStarted = resolve;
    });
    state.persistence = {
      ...persistence,
      async commitDocumentMutation(...args) {
        signalPersistStarted();
        await persistGate;
        return persistence.commitDocumentMutation(...args);
      },
    };

    const relink = relinkDocumentStore(
      state,
      {
        accessEpoch: 2,
        containerId: "replacement-container",
        documentId: fixture.writerProjection.documentId,
        localId,
      },
      () => undefined,
    );
    await persistStarted;
    resetDocumentStore(state);
    releasePersist();

    await expect(relink).resolves.toBeNull();
    expect(state.doc).toBeNull();
    expect(state.record).toBeNull();
    const durable = await sqlDocumentsPersistence.loadDocument(
      execSql,
      localId,
    );
    expect(durable?.containerId).toBe(originalDurable?.containerId);
  } finally {
    releasePersist();
    close();
  }
});

test("an expired structural generation rolls back a document relink", async () => {
  const { close, execSql } = await createTestExecSql(
    "relink-structural-generation",
  );
  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    const fixture = await createRemoteHistoryFixture();
    const localId = "relink-structural-generation-local";
    await persistFullHistoryDocument({
      doc: fixture.remoteDocument,
      documentId: fixture.writerProjection.documentId,
      execSql,
      localId,
    });
    let current = true;
    const persistence: typeof sqlDocumentsPersistence = {
      ...sqlDocumentsPersistence,
      commitDocumentMutation(...args) {
        current = false;
        return sqlDocumentsPersistence.commitDocumentMutation(...args);
      },
    };
    const state = createDocumentStoreState(
      localId,
      createRotationRecoveryRuntime({ execSql, fixture }),
      persistence,
      noopDocumentStorePersistenceEffects,
      fixture.writerProjection.documentId,
    );
    expect(await ensureDocumentStoreReady(state, () => undefined)).toBe(true);
    const originalDurable = await sqlDocumentsPersistence.loadDocument(
      execSql,
      localId,
    );

    await expect(
      relinkDocumentStore(
        state,
        {
          accessEpoch: 2,
          containerId: "replacement-container",
          documentId: fixture.writerProjection.documentId,
          localId,
          stillCurrent: () => current,
        },
        () => undefined,
      ),
    ).resolves.toBeNull();
    await expect(
      sqlDocumentsPersistence.loadDocument(execSql, localId),
    ).resolves.toMatchObject({
      containerId: originalDurable?.containerId,
    });
  } finally {
    close();
  }
});
