import { expect, test } from "bun:test";
import { createDocument, getTextValue, importSnapshot } from "@symcrypt/loro";
import { createTestExecSql } from "@symcrypt/test-utils";
import { sqlDocumentsPersistence } from "../../../data/persistence/documents/documentsPersistence";
import type { DocumentsPersistence } from "../../../workflows/documents";
import {
  createRemoteHistoryFixture,
  noopDocumentStorePersistenceEffects,
} from "./documentStore.testFixtures";
import { ensureDocumentStoreReady } from "./initialization";
import { assertDocumentStoreCanRotateContentKey } from "./rotation";
import {
  createRotationRecoveryRuntime,
  persistFullHistoryDocument,
} from "./rotationRecoveryHelpers.test";
import { createDocumentStoreState, type DocumentStoreState } from "./state";

test("rotation aborts a paged recovery when the runtime generation changes", async () => {
  const source = await createTestExecSql("rotation-recovery-generation-source");
  const replacement = await createTestExecSql(
    "rotation-recovery-generation-replacement",
  );
  try {
    await sqlDocumentsPersistence.ensureSchema(source.execSql);
    await sqlDocumentsPersistence.ensureSchema(replacement.execSql);
    const fixture = await createRemoteHistoryFixture();
    const localId = "rotation-recovery-generation-local";
    const behindDocument = await createDocument("rotation-generation-behind");
    importSnapshot(behindDocument, fixture.behindSnapshot);
    await persistFullHistoryDocument({
      doc: behindDocument,
      documentId: fixture.writerProjection.documentId,
      execSql: source.execSql,
      localId,
    });

    const [firstPageUpdate, secondPageUpdate] = fixture.response.updates;
    if (!firstPageUpdate || !secondPageUpdate) {
      throw new Error("Expected one retained update on each recovery page");
    }
    let state: DocumentStoreState | undefined;
    let rawRequests = 0;
    const runtime = createRotationRecoveryRuntime({
      execSql: source.execSql,
      fixture,
      responseForRequest: (request, response) => {
        rawRequests += 1;
        if (request.pullCursor !== undefined) {
          throw new Error("Stale recovery requested another history page");
        }
        if (!state) throw new Error("Expected initialized document store");
        state.runtime = createRotationRecoveryRuntime({
          execSql: replacement.execSql,
          fixture,
        });
        return {
          ...response,
          pullPage: { hasMore: true, nextCursor: "generation-page-2" },
          updates: [firstPageUpdate],
        };
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
      "Document changed during rotation recovery",
    );

    expect(rawRequests).toBe(1);
    const durableSource = await sqlDocumentsPersistence.loadDocument(
      source.execSql,
      localId,
    );
    expect(durableSource?.text).toBe("survives key");
    expect(
      await sqlDocumentsPersistence.loadDocument(replacement.execSql, localId),
    ).toBeNull();
    expect(state.doc && getTextValue(state.doc)).toBe("survives key");
  } finally {
    replacement.close();
    source.close();
  }
});

test("rotation refuses a persistence adapter without atomic recovery pruning", async () => {
  const { close, execSql } = await createTestExecSql(
    "rotation-recovery-adapter-capability",
  );
  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    const fixture = await createRemoteHistoryFixture();
    const localId = "rotation-recovery-adapter-capability-local";
    await persistFullHistoryDocument({
      doc: fixture.remoteDocument,
      documentId: fixture.writerProjection.documentId,
      execSql,
      localId,
    });
    const syncCalls = { count: 0 };
    const legacyPersistence = {
      ...sqlDocumentsPersistence,
      supportsAtomicRecoveryHistoryPruning: undefined,
    } satisfies DocumentsPersistence;
    const state = createDocumentStoreState(
      localId,
      createRotationRecoveryRuntime({ execSql, fixture, syncCalls }),
      legacyPersistence,
      noopDocumentStorePersistenceEffects,
      fixture.writerProjection.documentId,
    );
    expect(await ensureDocumentStoreReady(state, () => undefined)).toBe(true);

    await expect(assertDocumentStoreCanRotateContentKey(state)).rejects.toThrow(
      "requires an adapter with atomic local-history pruning",
    );

    expect(syncCalls.count).toBe(0);
    expect(
      (await sqlDocumentsPersistence.loadDocument(execSql, localId))?.text,
    ).toBe("survives key rotation");
  } finally {
    close();
  }
});
