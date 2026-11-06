import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { writerKeyResolver } from "../../../../test/helpers/documentFixtures";
import { syncRemoteDocumentWithoutImportValidationForTest as syncRemoteDocument } from "../../../../test/helpers/documentSync";
import {
  createReadOnlyResponseFixture,
  persistedStateFromProjection,
  readOnlySyncApi,
} from "../../../../test/helpers/documentSyncFixtures";
import { DocumentRawHistoryUnavailableError } from "../syncPlan/syncContentKeys";

test.each([
  ["caller-supplied", true, 1],
  ["API-cached", false, 2],
] as const)(
  "raw history refetches once after %s key unavailability",
  async (_projectionSource, supplyWriterProjection, expectedProjectionFetches) => {
    const fixture = await createReadOnlyResponseFixture();
    const { close, execSql } = await createTestExecSql(
      "persisted-raw-history-cached-unavailable",
    );
    let projectionFetches = 0;
    let projectionEvictions = 0;
    let injectUnavailable = true;

    try {
      const synced = await syncRemoteDocument({
        apiClient: readOnlySyncApi({
          fixture,
          onProjectionEviction: () => {
            projectionEvictions += 1;
          },
          onProjectionFetch: () => {
            projectionFetches += 1;
          },
        }),
        author: fixture.author,
        documentId: fixture.writerProjection.documentId,
        execSql,
        historyMode: "raw",
        localVersionVector: null,
        persistedState: persistedStateFromProjection(fixture.writerProjection),
        resolveProjectionUserKey: async (userId) => {
          if (injectUnavailable) {
            injectUnavailable = false;
            throw new DocumentRawHistoryUnavailableError(
              1,
              new Error("cached projection omitted a predecessor key"),
            );
          }
          return fixture.resolveProjectionUserKey(userId);
        },
        targetSecretKey: fixture.secretKey,
        ...(supplyWriterProjection
          ? { writerProjection: fixture.writerProjection }
          : {}),
        resolveWriterPublicKey: writerKeyResolver(fixture),
      });

      expect(projectionFetches).toBe(expectedProjectionFetches);
      expect(projectionEvictions).toBe(1);
      expect(synced?.writerProjection).toBe(fixture.writerProjection);
    } finally {
      close();
    }
  },
);

test("persisted raw history preserves availability when refresh returns null", async () => {
  const fixture = await createReadOnlyResponseFixture();
  const { close, execSql } = await createTestExecSql(
    "persisted-raw-history-null-refresh",
  );
  const unavailableError = new DocumentRawHistoryUnavailableError(
    1,
    new Error("fresh projection could not be fetched"),
  );
  let projectionFetches = 0;

  try {
    await expect(
      syncRemoteDocument({
        apiClient: readOnlySyncApi({
          fixture,
          onProjectionFetch: () => (projectionFetches += 1),
          projectionAfterEviction: null,
        }),
        author: fixture.author,
        documentId: fixture.writerProjection.documentId,
        execSql,
        historyMode: "raw",
        localVersionVector: null,
        persistedState: persistedStateFromProjection(fixture.writerProjection),
        resolveProjectionUserKey: fixture.resolveProjectionUserKey,
        resolveWriterPublicKey: writerKeyResolver(fixture),
        targetSecretKey: fixture.secretKey,
        validateIncomingUpdates: () => {
          throw unavailableError;
        },
      }),
    ).rejects.toBe(unavailableError);
    expect(projectionFetches).toBe(2);
  } finally {
    close();
  }
});

test("raw history reprocesses a submitted response with one fresh projection", async () => {
  const fixture = await createReadOnlyResponseFixture();
  const { close, execSql } = await createTestExecSql(
    "raw-history-submitted-projection-unavailable",
  );
  let injectUnavailable = true;
  let projectionEvictions = 0;
  let projectionFetches = 0;
  let submissions = 0;

  try {
    const synced = await syncRemoteDocument({
      apiClient: readOnlySyncApi({
        fixture,
        onProjectionEviction: () => {
          projectionEvictions += 1;
        },
        onProjectionFetch: () => {
          projectionFetches += 1;
        },
        onSync: () => {
          submissions += 1;
        },
      }),
      author: fixture.author,
      documentId: fixture.writerProjection.documentId,
      execSql,
      historyMode: "raw",
      localVersionVector: null,
      resolveProjectionUserKey: fixture.resolveProjectionUserKey,
      validateIncomingUpdates: () => {
        if (injectUnavailable) {
          injectUnavailable = false;
          throw new DocumentRawHistoryUnavailableError(
            1,
            new Error("cached projection omitted a predecessor key"),
          );
        }
      },
      targetSecretKey: fixture.secretKey,
      writerProjection: fixture.writerProjection,
      resolveWriterPublicKey: writerKeyResolver(fixture),
    });

    expect(projectionFetches).toBe(1);
    expect(projectionEvictions).toBe(1);
    expect(submissions).toBe(1);
    expect(synced?.writerProjection).toBe(fixture.writerProjection);
  } finally {
    close();
  }
});

test("raw history rejects an invalid zero-update first page without resubmitting", async () => {
  const fixture = await createReadOnlyResponseFixture();
  const { close, execSql } = await createTestExecSql(
    "persisted-raw-history-invalid-empty-first-page",
  );
  let submissions = 0;

  try {
    const sync = syncRemoteDocument({
      apiClient: readOnlySyncApi({
        fixture,
        onProjectionFetch: () => undefined,
        onSync: () => {
          submissions += 1;
        },
        zeroUpdateDocumentId: "550e8400-e29b-41d4-a716-446655440999",
      }),
      author: fixture.author,
      documentId: fixture.writerProjection.documentId,
      execSql,
      historyMode: "raw",
      localVersionVector: null,
      persistedState: persistedStateFromProjection(fixture.writerProjection),
      resolveProjectionUserKey: fixture.resolveProjectionUserKey,
      resolveWriterPublicKey: writerKeyResolver(fixture),
      targetSecretKey: fixture.secretKey,
      writerProjection: fixture.writerProjection,
    });

    await expect(sync).rejects.toMatchObject({
      code: "invalid_shape",
      message: "Document sync response document id mismatch",
    });
    expect(submissions).toBe(1);
  } finally {
    close();
  }
});
