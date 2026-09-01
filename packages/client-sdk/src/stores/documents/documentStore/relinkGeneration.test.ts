import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
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
import { createDocumentStoreState } from "./state";
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
