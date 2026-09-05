import { expect, test } from "bun:test";
import { db, getDefaultApiDatabaseKind } from "@tearleads/api-shared/postgres";
import { blobStages, blobs } from "@tearleads/api-shared/schema";
import { eq, sql } from "drizzle-orm";
import {
  blobObjectBytes,
  readBlobObjectText,
} from "../../../test/helpers/blobObjectStore";
import { createBlobStageOwner } from "../../../test/helpers/blobStageOwner";
import { gateTransactionSelectAfterExecution } from "../../../test/helpers/gateDatabaseSelect";
import {
  holdPostgresLock,
  waitForPostgresLockWait,
} from "../../../test/helpers/postgresConcurrency";
import { createServiceTestRuntime } from "../../../test/helpers/serviceRuntime";
import { sha256Hex } from "../../utils/sha256";
import { promoteStagedBlobIfPresent } from "../../workflows/blobs/mutations/persistence";
import {
  cleanupExpiredBlobStages,
  completeMultipartBlobStage,
  initiateMultipartBlobStage,
  uploadMultipartBlobPartBytes,
} from "./multipartStage";

async function createStageFixture() {
  const runtime = createServiceTestRuntime();
  const { userId, organizationId } = await createBlobStageOwner();
  const blobId = crypto.randomUUID();
  const bytes = blobObjectBytes("attachment committed during stage cleanup");
  const metadata = {
    byteLength: bytes.byteLength,
    sha256: await sha256Hex(bytes),
  };
  const stage = await initiateMultipartBlobStage(runtime, {
    organizationId,
    ...metadata,
    userId,
  });
  const part = await uploadMultipartBlobPartBytes(runtime, {
    ...metadata,
    bytes,
    partNumber: 1,
    stageId: stage.stageId,
    uploadId: stage.uploadId,
    userId,
  });
  await completeMultipartBlobStage(runtime, {
    parts: [{ etag: part.part.etag, partNumber: 1 }],
    stageId: stage.stageId,
    uploadId: stage.uploadId,
    userId,
  });
  const storageKey = `organizations/${organizationId}/blob-stages/${stage.stageId}`;
  const promotion = {
    blobId,
    expectedOrganizationId: organizationId,
    prevalidatedMultipartStage: {
      ...metadata,
      stageId: stage.stageId,
      storageKey,
    },
    request: {
      authorizingContainerPathRefs: [],
      body: {},
      contentKeyBundle: { contentKeyEpoch: 1, targetHash: "", targets: [] },
      event: {},
      stagedBlob: { stageId: stage.stageId, writeHeader: {} },
    },
    userId,
  };
  return { blobId, bytes, promotion, runtime, stage, storageKey };
}

test.skipIf(getDefaultApiDatabaseKind() !== "postgres")(
  "expiry cleanup preserves bytes promoted after its candidate snapshot",
  async () => {
    const { blobId, bytes, promotion, runtime, stage, storageKey } =
      await createStageFixture();
    const holder = await holdPostgresLock(async (executor) => {
      await promoteStagedBlobIfPresent({ ...promotion, executor });
    });
    let deletes = 0;
    const cleanup = cleanupExpiredBlobStages(
      {
        ...runtime,
        blobObjectStore: {
          ...runtime.blobObjectStore,
          deleteObject: async (key) => {
            if (key === storageKey) deletes += 1;
            await runtime.blobObjectStore.deleteObject(key);
          },
        },
      },
      { now: new Date(stage.expiresAt) },
    );
    try {
      await waitForPostgresLockWait({
        blockerPid: holder.backendPid,
        queryFragment: "blob_stages",
      });
      expect(deletes).toBe(0);
    } finally {
      await holder.release();
      await cleanup;
    }

    expect(await cleanup).toMatchObject({
      failedStages: 0,
    });
    expect(deletes).toBe(0);
    expect(await readBlobObjectText(runtime.blobObjectStore, storageKey)).toBe(
      new TextDecoder().decode(bytes),
    );
    expect(
      await db.select({ id: blobs.id }).from(blobs).where(eq(blobs.id, blobId)),
    ).toEqual([{ id: blobId }]);
    expect(
      await db
        .select({ id: blobStages.id })
        .from(blobStages)
        .where(eq(blobStages.id, stage.stageId)),
    ).toEqual([]);
  },
  30_000,
);

test.skipIf(getDefaultApiDatabaseKind() !== "postgres")(
  "promotion holds the stage from its active check through commit",
  async () => {
    const { promotion, runtime, stage, storageKey } =
      await createStageFixture();
    const reached = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    let backendPid = 0;
    const gatedDb = gateTransactionSelectAfterExecution({
      database: db,
      matchesSql: (query) => query.includes('from "blob_stages"'),
      occurrence: 1,
      reached: reached.resolve,
      release: release.promise,
    });
    const bind = gatedDb.transaction(async (executor) => {
      const result = await executor.execute(
        sql`select pg_backend_pid() as pid`,
      );
      backendPid = Number(Reflect.get(result.rows[0] ?? {}, "pid"));
      await promoteStagedBlobIfPresent({ ...promotion, executor });
    });
    await reached.promise;
    let deletes = 0;
    const cleanup = cleanupExpiredBlobStages(
      {
        ...runtime,
        blobObjectStore: {
          ...runtime.blobObjectStore,
          deleteObject: async (key) => {
            if (key === storageKey) deletes += 1;
            await runtime.blobObjectStore.deleteObject(key);
          },
        },
      },
      { now: new Date(stage.expiresAt) },
    );
    try {
      await waitForPostgresLockWait({
        blockerPid: backendPid,
        queryFragment: "blob_stages",
      });
      expect(deletes).toBe(0);
    } finally {
      release.resolve();
      await Promise.all([bind, cleanup]);
    }
    expect(await cleanup).toMatchObject({ failedStages: 0 });
    expect(deletes).toBe(0);
    expect(
      await readBlobObjectText(runtime.blobObjectStore, storageKey),
    ).not.toBeNull();
  },
  30_000,
);
