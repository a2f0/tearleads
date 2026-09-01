import { expect, test } from "bun:test";
import { KeyingVerificationError } from "@tearleads/crypto";
import { createTestExecSql } from "@tearleads/test-utils";
import type { DocumentWriterProjectionResponse } from "@tearleads/validators/response";
import {
  createMaterializedSyncFixture,
  createPendingUpdateRecord,
  createSyncResponse,
  writerKeyResolver,
} from "../../../test/helpers/documentFixtures";
import { syncRemoteDocumentWithoutImportValidationForTest as syncRemoteDocument } from "../../../test/helpers/documentSync";
import { DocumentRawHistoryUnavailableError } from "./syncContentKeys";
import { buildDocumentSyncPlan } from "./syncPlanIdentity";
import { buildMaterializedDocumentSyncPlan } from "./syncPlanMaterial";

function persistedStateFromProjection(
  projection: DocumentWriterProjectionResponse,
) {
  return {
    contentKeyBundle: JSON.stringify(projection.contentKeyBundle),
    documentId: projection.documentId,
    documentKekTargets: JSON.stringify(projection.documentKekTargets),
    documentManifestBundle: JSON.stringify(projection.documentManifest),
  };
}

async function createReadOnlyResponseFixture() {
  const fixture = await createMaterializedSyncFixture();
  const materialized = await buildMaterializedDocumentSyncPlan({
    author: fixture.author,
    localVersionVector: null,
    pendingUpdates: [createPendingUpdateRecord()],
    targetSecretKey: fixture.secretKey,
    trustedLocalProjection: true,
    writerProjection: fixture.writerProjection,
  });
  const response = await createSyncResponse(materialized.plan);
  const update = response.updates[0];
  if (!update) {
    throw new Error("Expected persisted read-only update fixture");
  }

  return { ...fixture, update };
}

function readOnlySyncApi(input: {
  corruptUpdate?: boolean | undefined;
  fixture: Awaited<ReturnType<typeof createReadOnlyResponseFixture>>;
  onProjectionEviction?: ((documentId: string) => void) | undefined;
  onProjectionFetch: () => void;
  onSync?: (() => void) | undefined;
  projectionAfterEviction?: DocumentWriterProjectionResponse | null;
  zeroUpdateDocumentId?: string | undefined;
}) {
  let projectionEvicted = false;
  return {
    evictDocumentWriterProjection: (documentId: string) => {
      projectionEvicted = true;
      input.onProjectionEviction?.(documentId);
    },
    getDocumentWriterProjection: async (documentId: string) => {
      input.onProjectionFetch();
      if (documentId !== input.fixture.writerProjection.documentId) return null;
      return projectionEvicted && input.projectionAfterEviction !== undefined
        ? input.projectionAfterEviction
        : input.fixture.writerProjection;
    },
    syncDocument: async (
      documentId: string,
      request: { localVersionVector: string | null },
    ) => {
      input.onSync?.();
      const plan = await buildDocumentSyncPlan({
        author: input.fixture.author,
        contentKeyBundle: input.fixture.writerProjection.contentKeyBundle,
        documentId,
        documentKekTargets: input.fixture.writerProjection.documentKekTargets,
        documentManifest: input.fixture.writerProjection.documentManifest,
        localVersionVector: request.localVersionVector,
      });
      return createSyncResponse(
        { ...plan, documentId, request: request as typeof plan.request },
        input.zeroUpdateDocumentId
          ? {
              documentId: input.zeroUpdateDocumentId,
              updates: [],
            }
          : {
              updates: [
                {
                  ...input.fixture.update,
                  ...(input.corruptUpdate
                    ? { encryptedData: "invalid-if-decryption-is-reached" }
                    : {}),
                },
              ],
            },
      );
    },
  };
}

test.each([
  "rollback",
  "invalid_shape",
] as const)("persisted read-only sync refetches once after a cached %s failure", async (code) => {
  const fixture = await createReadOnlyResponseFixture();
  const { close, execSql } = await createTestExecSql(
    `persisted-read-only-cached-${code}`,
  );
  let projectionFetches = 0;
  let projectionEvictions = 0;
  let injectRollback = true;

  try {
    const synced = await syncRemoteDocument({
      apiClient: readOnlySyncApi({
        fixture,
        onProjectionEviction: (documentId) => {
          expect(documentId).toBe(fixture.writerProjection.documentId);
          projectionEvictions += 1;
        },
        onProjectionFetch: () => {
          projectionFetches += 1;
        },
      }),
      author: fixture.author,
      documentId: fixture.writerProjection.documentId,
      execSql,
      localVersionVector: null,
      persistedState: persistedStateFromProjection(fixture.writerProjection),
      resolveProjectionUserKey: async (userId) => {
        if (injectRollback) {
          injectRollback = false;
          throw new KeyingVerificationError(
            code,
            "cached projection is behind the local checkpoint",
          );
        }
        return fixture.resolveProjectionUserKey(userId);
      },
      targetSecretKey: fixture.secretKey,
      writerProjection: fixture.writerProjection,
      resolveWriterPublicKey: writerKeyResolver(fixture),
    });

    expect(projectionFetches).toBe(1);
    expect(projectionEvictions).toBe(1);
    expect(synced?.writerProjection).toBe(fixture.writerProjection);
  } finally {
    close();
  }
});

test.each([
  ["caller-supplied", true, 1],
  ["API-cached", false, 2],
] as const)("raw history refetches once after %s key unavailability", async (_projectionSource, supplyWriterProjection, expectedProjectionFetches) => {
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
});

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

test("persisted read-only sync retries a getter-origin rollback after eviction", async () => {
  const fixture = await createReadOnlyResponseFixture();
  const { close, execSql } = await createTestExecSql(
    "persisted-read-only-getter-rollback",
  );
  let projectionFetches = 0;
  let projectionEvictions = 0;
  let injectRollback = true;

  try {
    const synced = await syncRemoteDocument({
      apiClient: readOnlySyncApi({
        fixture,
        onProjectionEviction: (documentId) => {
          expect(documentId).toBe(fixture.writerProjection.documentId);
          projectionEvictions += 1;
        },
        onProjectionFetch: () => {
          projectionFetches += 1;
        },
      }),
      author: fixture.author,
      documentId: fixture.writerProjection.documentId,
      execSql,
      localVersionVector: null,
      persistedState: persistedStateFromProjection(fixture.writerProjection),
      resolveProjectionUserKey: async (userId) => {
        if (injectRollback) {
          injectRollback = false;
          throw new KeyingVerificationError(
            "rollback",
            "fetched projection lost a race with a local checkpoint",
          );
        }
        return fixture.resolveProjectionUserKey(userId);
      },
      targetSecretKey: fixture.secretKey,
      resolveWriterPublicKey: writerKeyResolver(fixture),
    });

    expect(projectionFetches).toBe(2);
    expect(projectionEvictions).toBe(1);
    expect(synced?.writerProjection).toBe(fixture.writerProjection);
  } finally {
    close();
  }
});

test("persisted read-only sync propagates rollback after the evicted refetch", async () => {
  const fixture = await createReadOnlyResponseFixture();
  const { close, execSql } = await createTestExecSql(
    "persisted-read-only-repeated-rollback",
  );
  let projectionFetches = 0;
  let projectionEvictions = 0;

  try {
    await expect(
      syncRemoteDocument({
        apiClient: readOnlySyncApi({
          corruptUpdate: true,
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
        localVersionVector: null,
        persistedState: persistedStateFromProjection(fixture.writerProjection),
        resolveProjectionUserKey: async () => {
          throw new KeyingVerificationError(
            "rollback",
            "post-eviction projection is still behind the checkpoint",
          );
        },
        targetSecretKey: fixture.secretKey,
        resolveWriterPublicKey: writerKeyResolver(fixture),
      }),
    ).rejects.toMatchObject({ code: "rollback" });
    expect(projectionFetches).toBe(2);
    expect(projectionEvictions).toBe(1);
  } finally {
    close();
  }
});

test.each([
  "equivocation",
  "invalid_shape",
  "object_mismatch",
  "stale_predecessor",
] as const)("persisted read-only sync propagates %s from a fresh projection", async (code) => {
  const fixture = await createReadOnlyResponseFixture();
  const { close, execSql } = await createTestExecSql(
    `persisted-read-only-fresh-${code}`,
  );
  let projectionFetches = 0;
  const integrityError = new KeyingVerificationError(
    code,
    `fresh projection failed with ${code}`,
  );

  try {
    await expect(
      syncRemoteDocument({
        apiClient: readOnlySyncApi({
          corruptUpdate: true,
          fixture,
          onProjectionFetch: () => {
            projectionFetches += 1;
          },
        }),
        author: fixture.author,
        documentId: fixture.writerProjection.documentId,
        execSql,
        localVersionVector: null,
        persistedState: persistedStateFromProjection(fixture.writerProjection),
        resolveProjectionUserKey: async () => {
          throw integrityError;
        },
        targetSecretKey: fixture.secretKey,
        resolveWriterPublicKey: writerKeyResolver(fixture),
      }),
    ).rejects.toBe(integrityError);
    expect(projectionFetches).toBe(1);
  } finally {
    close();
  }
});

test("remote sync rejects resolver-backed local trust before submission", async () => {
  const fixture = await createMaterializedSyncFixture();
  let submissions = 0;
  const input = {
    apiClient: {
      getDocumentWriterProjection: async () => fixture.writerProjection,
      syncDocument: async () => {
        submissions += 1;
        return null;
      },
    },
    author: fixture.author,
    documentId: fixture.writerProjection.documentId,
    localVersionVector: null,
    pendingUpdates: [createPendingUpdateRecord()],
    resolveProjectionUserKey: fixture.resolveProjectionUserKey,
    targetSecretKey: fixture.secretKey,
    trustedLocalProjection: true,
    writerProjection: fixture.writerProjection,
  } as unknown as Parameters<typeof syncRemoteDocument>[0];

  await expect(syncRemoteDocument(input)).rejects.toThrow(
    "Projection use cannot combine key verification with local projection trust",
  );
  expect(submissions).toBe(0);
});
