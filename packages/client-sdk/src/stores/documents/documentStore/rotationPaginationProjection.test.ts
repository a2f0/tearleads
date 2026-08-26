import { expect, test } from "bun:test";
import { createDocument, getTextValue, importSnapshot } from "@symcrypt/loro";
import { createTestExecSql } from "@symcrypt/test-utils";
import { sqlDocumentsPersistence } from "../../../data/persistence/documents/documentsPersistence";
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
import { createDocumentStoreState } from "./state";

test("raw continuation pages use projection state verified by the prior page", async () => {
  const { close, execSql } = await createTestExecSql(
    "rotation-pagination-projection-refresh",
  );
  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    const fixture = await createRemoteHistoryFixture();
    const localId = "rotation-pagination-projection-refresh-local";
    const behindDocument = await createDocument(
      "rotation-pagination-projection-behind",
    );
    importSnapshot(behindDocument, fixture.behindSnapshot);
    await persistFullHistoryDocument({
      doc: behindDocument,
      documentId: fixture.writerProjection.documentId,
      execSql,
      localId,
    });
    const persistedRecord = await sqlDocumentsPersistence.loadDocument(
      execSql,
      localId,
    );
    if (!persistedRecord) throw new Error("Expected persisted document");
    const currentEpoch =
      fixture.writerProjection.contentKeyBundle.contentKeyEpoch;
    const staleEpoch = currentEpoch + 1;
    await sqlDocumentsPersistence.saveDocument(execSql, {
      ...persistedRecord,
      contentKeyBundle: JSON.stringify({
        ...fixture.writerProjection.contentKeyBundle,
        contentKeyEpoch: staleEpoch,
      }),
      documentKekTargets: JSON.stringify(
        fixture.writerProjection.documentKekTargets,
      ),
      documentManifestBundle: JSON.stringify(
        fixture.writerProjection.documentManifest,
      ),
    });

    const [firstPageUpdate, secondPageUpdate] = fixture.response.updates;
    if (!firstPageUpdate || !secondPageUpdate) {
      throw new Error("Expected one retained update on each recovery page");
    }
    const baseRuntime = createRotationRecoveryRuntime({ execSql, fixture });
    const baseApiClient = baseRuntime.apiClient;
    let projectionFetches = 0;
    let staleRequests = 0;
    const requestEpochs: number[] = [];
    const apiClient = {
      ...baseApiClient,
      getDocumentWriterProjection: async () => {
        projectionFetches += 1;
        return fixture.writerProjection;
      },
      syncDocumentResult: async (
        documentId: Parameters<
          NonNullable<typeof baseApiClient.syncDocumentResult>
        >[0],
        request: Parameters<
          NonNullable<typeof baseApiClient.syncDocumentResult>
        >[1],
      ) => {
        requestEpochs.push(request.contentKeyEpoch);
        if (request.contentKeyEpoch === staleEpoch) {
          staleRequests += 1;
          return {
            code: "document_sync_state_stale",
            kind: "http" as const,
            message: "persisted projection is stale",
            method: "POST" as const,
            ok: false as const,
            path: `/documents/${documentId}/sync`,
            report: () => undefined,
            status: 409,
            statusText: "Conflict",
          };
        }
        const response = await baseApiClient.syncDocument(documentId, request);
        if (!response) throw new Error("Expected document sync response");
        if (request.pullCursor === undefined) {
          return {
            data: {
              ...response,
              pullPage: { hasMore: true, nextCursor: "fresh-page-2" },
              updates: [firstPageUpdate],
            },
            ok: true as const,
          };
        }
        if (request.pullCursor !== "fresh-page-2") {
          throw new Error("Unexpected raw-history pull cursor");
        }
        return {
          data: {
            ...response,
            pullPage: { hasMore: false, nextCursor: null },
            updates: [secondPageUpdate],
          },
          ok: true as const,
        };
      },
    } as unknown as typeof baseApiClient;
    const runtime = { ...baseRuntime, apiClient };
    const state = createDocumentStoreState(
      localId,
      runtime,
      sqlDocumentsPersistence,
      noopDocumentStorePersistenceEffects,
      fixture.writerProjection.documentId,
    );
    expect(await ensureDocumentStoreReady(state, () => undefined)).toBe(true);

    const baseline = await assertDocumentStoreCanRotateContentKey(state);
    expect(baseline).toBeInstanceOf(Uint8Array);

    expect(staleRequests).toBe(1);
    expect(projectionFetches).toBe(1);
    expect(requestEpochs).toEqual([staleEpoch, currentEpoch, currentEpoch]);
    expect(state.doc && getTextValue(state.doc)).toBe("survives key rotation");
  } finally {
    close();
  }
});

test("raw rotation recovery rejects a multi-page cursor cycle", async () => {
  const { close, execSql } = await createTestExecSql(
    "rotation-pagination-cursor-cycle",
  );
  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    const fixture = await createRemoteHistoryFixture();
    const localId = "rotation-pagination-cursor-cycle-local";
    await persistFullHistoryDocument({
      doc: fixture.remoteDocument,
      documentId: fixture.writerProjection.documentId,
      execSql,
      localId,
    });
    const requestedCursors: Array<string | undefined> = [];
    const runtime = createRotationRecoveryRuntime({
      execSql,
      fixture,
      responseForRequest: (request, response) => {
        requestedCursors.push(request.pullCursor);
        const nextCursor =
          request.pullCursor === undefined
            ? "cycle-a"
            : request.pullCursor === "cycle-a"
              ? "cycle-b"
              : "cycle-a";
        return {
          ...response,
          pullPage: { hasMore: true, nextCursor },
          updates: [],
        };
      },
    });
    const state = createDocumentStoreState(
      localId,
      runtime,
      sqlDocumentsPersistence,
      noopDocumentStorePersistenceEffects,
      fixture.writerProjection.documentId,
    );
    expect(await ensureDocumentStoreReady(state, () => undefined)).toBe(true);

    await expect(assertDocumentStoreCanRotateContentKey(state)).rejects.toThrow(
      "repeated pull cursor",
    );
    expect(requestedCursors).toEqual([undefined, "cycle-a", "cycle-b"]);
  } finally {
    close();
  }
});
