import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { createUnreachableEpochFixture } from "../../../../../test/helpers/workflows/rawHistoryFixtures";
import { createRotationRecoveryRuntime } from "../../../../../test/helpers/workflows/rotationRecoveryRuntime";
import { sqlDocumentsPersistence } from "../../../../data/persistence/documents/documentsPersistence";
import { DocumentRawHistoryUnavailableError } from "../../../../workflows/documents";
import {
  createRemoteHistoryFixture,
  noopDocumentStorePersistenceEffects,
} from "../documentStore.testFixtures";
import { ensureDocumentStoreReady } from "../initialization";
import { createDocumentStoreState } from "../state";
import { assertDocumentStoreCanRotateContentKey } from "./index";

test("raw rotation reports unavailable predecessor history after its persisted-state submit", async () => {
  const { close, execSql } = await createTestExecSql(
    "rotation-raw-history-missing-predecessor",
  );
  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    const fixture = await createRemoteHistoryFixture();
    const localId = "rotation-raw-history-missing-predecessor-local";
    const currentFixture = await createUnreachableEpochFixture({
      execSql,
      fixture,
      localId,
    });
    const originalRecord = await sqlDocumentsPersistence.loadDocument(
      execSql,
      localId,
    );
    const syncCalls = { count: 0 };
    const state = createDocumentStoreState(
      localId,
      createRotationRecoveryRuntime({
        execSql,
        fixture: currentFixture,
        syncCalls,
      }),
      sqlDocumentsPersistence,
      noopDocumentStorePersistenceEffects,
      fixture.writerProjection.documentId,
    );
    expect(await ensureDocumentStoreReady(state, () => undefined)).toBe(true);
    state.writerProjection = null;

    const error = await assertDocumentStoreCanRotateContentKey(state).then(
      () => null,
      (thrown: unknown) => thrown,
    );

    expect(error).toBeInstanceOf(DocumentRawHistoryUnavailableError);
    expect((error as DocumentRawHistoryUnavailableError).contentKeyEpoch).toBe(
      fixture.writerProjection.contentKeyBundle.contentKeyEpoch,
    );
    expect(syncCalls.count).toBe(1);
    expect(
      await sqlDocumentsPersistence.loadDocument(execSql, localId),
    ).toEqual(originalRecord);
  } finally {
    close();
  }
});
