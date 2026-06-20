import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { blobStages } from "@tearleads/api-shared/schema";
import { eq } from "drizzle-orm";
import { createServiceTestRuntime } from "../../../test/helpers/serviceRuntime";
import { createMemoryBlobObjectStore } from "../../adapters/blobObjectStore";
import { readMultipartBlobStageRecord } from "../../utils/blobStageRecords";
import { sha256Hex } from "../../utils/sha256";
import { StageBlobError, stageBlob } from "./stageBlob";

async function readObjectStoreText(
  store: ReturnType<typeof createMemoryBlobObjectStore>,
  key: string,
): Promise<string | null> {
  const stream = await store.getObjectStream(key);
  return stream === null ? null : new Response(stream).text();
}

async function createStageBlobInput(encryptedBytes: string) {
  return {
    encryptedBytes,
    byteLength: new TextEncoder().encode(encryptedBytes).byteLength,
    sha256: await sha256Hex(encryptedBytes),
  };
}

async function expectStageBlobError(
  promise: Promise<unknown>,
): Promise<StageBlobError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(StageBlobError);
    return error as StageBlobError;
  }

  throw new Error("Expected stageBlob to fail");
}

test("stageBlob validates and stores staged encrypted bytes", async () => {
  const userId = crypto.randomUUID();
  const input = await createStageBlobInput("encrypted payload");

  const result = await stageBlob(createServiceTestRuntime(), {
    ...input,
    userId,
  });

  expect(result.stageId).toHaveLength(36);
  expect(new Date(result.expiresAt).getTime()).toBeGreaterThan(Date.now());

  const [stage] = await db
    .select({
      encryptedBytes: blobStages.encryptedBytes,
      ownerUserId: blobStages.ownerUserId,
      sha256: blobStages.sha256,
    })
    .from(blobStages)
    .where(eq(blobStages.id, result.stageId))
    .limit(1);

  expect(stage).toEqual({
    encryptedBytes: input.encryptedBytes,
    ownerUserId: userId,
    sha256: input.sha256,
  });
});

test("stageBlob offloads bytes to the object store when configured", async () => {
  const userId = crypto.randomUUID();
  const input = await createStageBlobInput("encrypted payload");
  const blobObjectStore = createMemoryBlobObjectStore();

  const result = await stageBlob(
    createServiceTestRuntime(db, {
      blobObjectStore,
      blobObjectStoreKind: "s3",
    }),
    { ...input, userId },
  );

  const storageKey = `blob-stages/${result.stageId}`;
  expect(await readObjectStoreText(blobObjectStore, storageKey)).toBe(
    input.encryptedBytes,
  );

  const [stage] = await db
    .select({ encryptedBytes: blobStages.encryptedBytes })
    .from(blobStages)
    .where(eq(blobStages.id, result.stageId))
    .limit(1);

  // The Postgres row must hold an external pointer, not the inline bytes.
  expect(stage?.encryptedBytes).not.toBe(input.encryptedBytes);
  const record = readMultipartBlobStageRecord(stage?.encryptedBytes ?? "");
  expect(record).toMatchObject({ state: "complete", storageKey });
});

test("stageBlob rejects mismatched bytes and digests", async () => {
  const userId = crypto.randomUUID();
  const input = await createStageBlobInput("encrypted payload");

  const badLength = await expectStageBlobError(
    stageBlob(createServiceTestRuntime(), {
      ...input,
      byteLength: input.byteLength + 1,
      userId,
    }),
  );
  expect(badLength.status).toBe(400);
  expect(badLength.message).toBe(
    "Blob byteLength does not match encryptedBytes",
  );

  const badDigest = await expectStageBlobError(
    stageBlob(createServiceTestRuntime(), {
      ...input,
      sha256: "bad-digest",
      userId,
    }),
  );
  expect(badDigest.status).toBe(400);
  expect(badDigest.message).toBe("Blob sha256 does not match encryptedBytes");
});
