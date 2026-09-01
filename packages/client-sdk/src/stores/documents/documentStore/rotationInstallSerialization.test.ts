import { expect, test } from "bun:test";
import { getTextValue } from "@tearleads/loro";
import { createTestExecSql } from "@tearleads/test-utils";
import { sqlDocumentsPersistence } from "../../../data/persistence/documents/documentsPersistence";
import type { DocumentsPersistence } from "../../../workflows/documents";
import {
  createRemoteHistoryFixture,
  noopDocumentStorePersistenceEffects,
} from "./documentStore.testFixtures";
import { chainIdentityWrite } from "./identityWriteChain";
import { ensureDocumentStoreReady } from "./initialization";
import { assertDocumentStoreCanRotateContentKey } from "./rotation";
import {
  createRotationRecoveryRuntime,
  persistFullHistoryDocument,
} from "./rotationRecoveryHelpers.test";
import { createDocumentStoreState, type DocumentStoreState } from "./state";

test("rotation serializes its final verification and history install", async () => {
  const { close, execSql } = await createTestExecSql(
    "rotation-install-serialization",
  );
  let releaseCompetingWrite: () => void = () => {};
  const competingWriteBlocked = new Promise<void>((resolve) => {
    releaseCompetingWrite = resolve;
  });
  let reportCompetingWriteStarted: () => void = () => {};
  const competingWriteStarted = new Promise<void>((resolve) => {
    reportCompetingWriteStarted = resolve;
  });
  let reportInstallStarted: () => void = () => {};
  const installStarted = new Promise<void>((resolve) => {
    reportInstallStarted = resolve;
  });
  let state: DocumentStoreState | null = null;
  const competingWriteRef: { current: Promise<void> | null } = {
    current: null,
  };

  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    const fixture = await createRemoteHistoryFixture();
    const localId = "rotation-install-serialization-local";
    await persistFullHistoryDocument({
      doc: fixture.remoteDocument,
      documentId: fixture.writerProjection.documentId,
      execSql,
      localId,
    });
    const runtime = createRotationRecoveryRuntime({
      execSql,
      fixture,
      responseForRequest: async (request, response) => {
        if (request.historyMode === "raw" && !competingWriteRef.current) {
          const currentState = state;
          if (!currentState) throw new Error("Expected initialized state");
          competingWriteRef.current = chainIdentityWrite(
            currentState,
            async () => {
              reportCompetingWriteStarted();
              await competingWriteBlocked;
              const currentDocument = currentState.doc;
              if (!currentDocument || !currentState.record) {
                throw new Error("Expected live document state");
              }
              currentDocument.getText("text").update("concurrent sync winner");
              currentDocument.commit();
              currentState.record = {
                ...currentState.record,
                text: "concurrent sync winner",
              };
            },
          );
          await competingWriteStarted;
        }
        return response;
      },
    });
    let installAttempts = 0;
    const persistence: DocumentsPersistence = {
      ...sqlDocumentsPersistence,
      commitDocumentMutation: async (...args) => {
        if (args[1].historyCheckpoint) {
          installAttempts += 1;
          reportInstallStarted();
        }
        return sqlDocumentsPersistence.commitDocumentMutation(...args);
      },
    };
    state = createDocumentStoreState(
      localId,
      runtime,
      persistence,
      noopDocumentStorePersistenceEffects,
      fixture.writerProjection.documentId,
    );
    expect(await ensureDocumentStoreReady(state, () => undefined)).toBe(true);

    const recovery = assertDocumentStoreCanRotateContentKey(state);
    await competingWriteStarted;
    const installRacedCompetingWrite = await Promise.race([
      installStarted.then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 50)),
    ]);
    expect(installRacedCompetingWrite).toBe(false);

    releaseCompetingWrite();
    await competingWriteRef.current;
    await expect(recovery).rejects.toThrow("Document changed");
    expect(installAttempts).toBe(0);
    expect(state.doc && getTextValue(state.doc)).toBe("concurrent sync winner");
  } finally {
    releaseCompetingWrite();
    await competingWriteRef.current?.catch(() => undefined);
    close();
  }
});

test("rotation keeps the definitive pull record as its install CAS baseline", async () => {
  const { close, execSql } = await createTestExecSql(
    "rotation-install-metadata-cas",
  );
  let state: DocumentStoreState | null = null;
  const advancedCommitLsn = "0/16B6C51";
  let metadataAdvanced = false;

  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    const fixture = await createRemoteHistoryFixture();
    const localId = "rotation-install-metadata-cas-local";
    await persistFullHistoryDocument({
      doc: fixture.remoteDocument,
      documentId: fixture.writerProjection.documentId,
      execSql,
      localId,
    });
    const runtime = createRotationRecoveryRuntime({
      execSql,
      fixture,
      responseForRequest: async (request, response) => {
        const currentState = state;
        if (
          request.historyMode === "raw" &&
          !metadataAdvanced &&
          currentState?.record
        ) {
          metadataAdvanced = true;
          const advancedRecord = {
            ...currentState.record,
            lastCommitLsn: advancedCommitLsn,
          };
          await sqlDocumentsPersistence.saveDocument(execSql, advancedRecord);
          currentState.record = advancedRecord;
        }
        return response;
      },
    });
    state = createDocumentStoreState(
      localId,
      runtime,
      sqlDocumentsPersistence,
      noopDocumentStorePersistenceEffects,
      fixture.writerProjection.documentId,
    );
    expect(await ensureDocumentStoreReady(state, () => undefined)).toBe(true);

    await expect(assertDocumentStoreCanRotateContentKey(state)).rejects.toThrow(
      "superseded",
    );

    expect(metadataAdvanced).toBe(true);
    expect(state.record?.lastCommitLsn).toBe(advancedCommitLsn);
    expect(
      (await sqlDocumentsPersistence.loadDocument(execSql, localId))
        ?.lastCommitLsn,
    ).toBe(advancedCommitLsn);
  } finally {
    close();
  }
});
