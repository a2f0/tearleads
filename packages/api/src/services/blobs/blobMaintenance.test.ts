import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { blobs } from "@tearleads/api-shared/schema";
import { readBlobObjectText } from "../../../test/helpers/blobObjectStore";
import { createServiceTestRuntime } from "../../../test/helpers/serviceRuntime";
import { encodeExternalBlobBytesRef } from "../../utils/blobStageRecords";
import { sha256Hex } from "../../utils/sha256";
import { reclaimDereferencedBlobs } from "./blobMaintenance";

const HOUR_MS = 60 * 60 * 1000;

test("reclaimDereferencedBlobs deletes the reclaimed object-store bytes after commit", async () => {
  const runtime = createServiceTestRuntime();
  const blobId = crypto.randomUUID();
  const storageKey = `blob-object:${blobId}`;
  const bytes = "reclaimable-bytes";
  await runtime.blobObjectStore.putObject({
    bytes,
    key: storageKey,
    sha256: await sha256Hex(bytes),
  });
  await db.insert(blobs).values({
    id: blobId,
    storageKey,
    encryptedBytes: encodeExternalBlobBytesRef({ storageKey }),
    sha256: await sha256Hex(bytes),
    byteLength: bytes.length,
    dereferencedAt: new Date(Date.now() - 48 * HOUR_MS),
  });

  const summary = await reclaimDereferencedBlobs(runtime, {
    gracePeriodMs: 24 * HOUR_MS,
  });

  expect(summary.reclaimedCount).toBeGreaterThanOrEqual(1);
  expect(summary.deletedObjectCount).toBeGreaterThanOrEqual(1);
  expect(
    await readBlobObjectText(runtime.blobObjectStore, storageKey),
  ).toBeNull();
});
