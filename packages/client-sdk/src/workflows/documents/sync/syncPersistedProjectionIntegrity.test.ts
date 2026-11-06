import { expect, test } from "bun:test";
import { KeyingVerificationError } from "@tearleads/crypto";
import { createMockApiClient, createTestExecSql } from "@tearleads/test-utils";
import {
  createMaterializedSyncFixture,
  createPendingUpdateRecord,
  writerKeyResolver,
} from "../../../../test/helpers/documentFixtures";
import { syncRemoteDocumentWithoutImportValidationForTest as syncRemoteDocument } from "../../../../test/helpers/documentSync";
import {
  createReadOnlyResponseFixture,
  persistedStateFromProjection,
  readOnlySyncApi,
} from "../../../../test/helpers/documentSyncFixtures";

test.each(["rollback", "invalid_shape"] as const)(
  "persisted read-only sync refetches once after a cached %s failure",
  async (code) => {
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
  },
);

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
] as const)(
  "persisted read-only sync propagates %s from a fresh projection",
  async (code) => {
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
          persistedState: persistedStateFromProjection(
            fixture.writerProjection,
          ),
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
  },
);

test("remote sync rejects resolver-backed local trust before submission", async () => {
  const fixture = await createMaterializedSyncFixture();
  let submissions = 0;
  const input = {
    apiClient: createMockApiClient({
      getDocumentWriterProjection: async () => fixture.writerProjection,
      syncDocument: async () => {
        submissions += 1;
        return null;
      },
    }),
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
