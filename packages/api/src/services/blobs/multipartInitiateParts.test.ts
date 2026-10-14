import { afterEach, expect, mock, test } from "bun:test";
import { createHash } from "node:crypto";
import { blobStages } from "@tearleads/api-shared/schema";
import { eq } from "drizzle-orm";
import { createBlobStageOwner } from "../../../test/helpers/blobStageOwner";
import { createServiceTestRuntime } from "../../../test/helpers/serviceRuntime";
import { sha256Hex } from "../../utils/sha256";
import type { ApiServiceRuntime } from "../runtime";
import { initiateMultipartBlobStage } from "./multipartStage";

const MIB = 1024 * 1024;
const createdStages: { runtime: ApiServiceRuntime; stageId: string }[] = [];
afterEach(async () => {
  for (const { runtime, stageId } of createdStages.splice(0)) {
    await runtime.db.delete(blobStages).where(eq(blobStages.id, stageId));
  }
});

function md5(bytes: Uint8Array): string {
  return createHash("md5").update(bytes).digest("base64");
}

function signingRuntime() {
  const runtime = createServiceTestRuntime();
  const createMultipartUpload = mock(
    runtime.blobObjectStore.createMultipartUpload,
  );
  const createUploadPartUrl = mock(
    async (input: {
      readonly partNumber: number;
      readonly expiresIn: number;
    }) => ({
      url: `https://storage.test/part?partNumber=${input.partNumber}`,
      expiresAt: new Date(Date.now() + input.expiresIn * 1000).toISOString(),
    }),
  );
  runtime.blobObjectStore = {
    ...runtime.blobObjectStore,
    createMultipartUpload,
    createUploadPartUrl,
  };
  return { createMultipartUpload, createUploadPartUrl, runtime };
}

test("stage initiation signs each described first part in its response", async () => {
  const owner = await createBlobStageOwner();
  const { createUploadPartUrl, runtime } = signingRuntime();
  const bytes = new Uint8Array(6 * MIB).map((_, index) => index % 251);
  const firstParts = [
    {
      byteLength: 5 * MIB,
      contentMd5: md5(bytes.subarray(0, 5 * MIB)),
      partNumber: 1,
    },
    {
      byteLength: MIB,
      contentMd5: md5(bytes.subarray(5 * MIB)),
      partNumber: 2,
    },
  ];
  const stage = await initiateMultipartBlobStage(runtime, {
    ...owner,
    byteLength: bytes.byteLength,
    firstParts,
    sha256: sha256Hex(bytes),
  });
  createdStages.push({ runtime, stageId: stage.stageId });

  expect(stage.partUploads).toEqual(
    firstParts.map((part) => ({
      ...part,
      source: {
        kind: "signed-url",
        url: `https://storage.test/part?partNumber=${part.partNumber}`,
        expiresAt: expect.any(String),
      },
    })),
  );
  expect(createUploadPartUrl.mock.calls.map(([call]) => call)).toEqual(
    firstParts.map((part) => ({
      ...part,
      expiresIn: 300,
      key: `organizations/${owner.organizationId}/blob-stages/${stage.stageId}`,
      uploadId: stage.uploadId,
    })),
  );
});

test("stage initiation refuses first parts the stage cannot hold before any upload exists", async () => {
  const owner = await createBlobStageOwner();
  const { createMultipartUpload, createUploadPartUrl, runtime } =
    signingRuntime();
  const part = { byteLength: 4, contentMd5: md5(new Uint8Array(4)) };
  for (const firstParts of [
    // The same part twice.
    [
      { ...part, partNumber: 1 },
      { ...part, partNumber: 1 },
    ],
    // A part number a 4-byte object never reaches with 5 MiB parts.
    [{ ...part, partNumber: 2 }],
    // A part longer than the declared object.
    [{ ...part, byteLength: 5, partNumber: 1 }],
    // Parts that together exceed the declared object.
    [
      { ...part, byteLength: 3, partNumber: 1 },
      { ...part, byteLength: 3, partNumber: 2 },
    ],
  ]) {
    await expect(
      initiateMultipartBlobStage(runtime, {
        ...owner,
        byteLength: 4,
        firstParts,
        sha256: sha256Hex(new Uint8Array(4)),
      }),
    ).rejects.toMatchObject({ status: 400 });
  }
  expect(createMultipartUpload).not.toHaveBeenCalled();
  expect(createUploadPartUrl).not.toHaveBeenCalled();
});

test("a store that cannot sign answers every first part with the API route", async () => {
  const owner = await createBlobStageOwner();
  const runtime = createServiceTestRuntime();
  const bytes = new Uint8Array([1, 2, 3]);
  const firstPart = {
    byteLength: bytes.byteLength,
    contentMd5: md5(bytes),
    partNumber: 1,
  };
  const stage = await initiateMultipartBlobStage(runtime, {
    ...owner,
    byteLength: bytes.byteLength,
    firstParts: [firstPart],
    sha256: sha256Hex(bytes),
  });
  createdStages.push({ runtime, stageId: stage.stageId });
  expect(stage.partUploads).toEqual([
    { ...firstPart, source: { kind: "api" } },
  ]);
});
