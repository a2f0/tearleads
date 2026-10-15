import { afterEach, expect, mock, spyOn, test } from "bun:test";
import { createHash } from "node:crypto";
import { blobStages } from "@tearleads/api-shared/schema";
import { MultipartBlobPartUploadResponseSchema } from "@tearleads/validators/operation";
import { MAX_MULTIPART_BLOB_PART_BYTES } from "@tearleads/validators/util";
import { eq } from "drizzle-orm";
import { createMiddleware } from "hono/factory";
import { createBlobStageOwner } from "../../../test/helpers/blobStageOwner";
import { completeStageAsBind } from "../../../test/helpers/blobStageParts";
import { createServiceTestRuntime } from "../../../test/helpers/serviceRuntime";
import { requireAuth, type SessionEnv } from "../../middleware/session";
import { createRouteApp } from "../../routeApp";
import {
  getMultipartBlobStage,
  initiateMultipartBlobStage,
  uploadMultipartBlobPartBytes,
} from "../../services/blobs/multipartStage";
import type { ApiServiceRuntime } from "../../services/runtime";
import { sha256Hex } from "../../utils/sha256";
import { createMultipartPartUploadRoute } from "./multipartPartUpload";

const createdStages: { runtime: ApiServiceRuntime; stageId: string }[] = [];
afterEach(async () => {
  for (const { runtime, stageId } of createdStages.splice(0)) {
    await runtime.db.delete(blobStages).where(eq(blobStages.id, stageId));
  }
});

function authenticated(userId: string) {
  return createMiddleware<SessionEnv>(async (c, next) => {
    c.set("session", {
      createdAt: Date.now(),
      fingerprint: "test",
      id: "test",
      ipAddresses: [],
      lastActiveAt: Date.now(),
      lastActiveIp: null,
      userId,
    });
    return next();
  });
}
async function fixture(
  bytes = new TextEncoder().encode("part-1part-2"),
  firstPartByteLength = 6,
) {
  const owner = await createBlobStageOwner();
  const runtime = createServiceTestRuntime();
  const memory = runtime.blobObjectStore;
  const contentMd5 = createHash("md5")
    .update(bytes.subarray(0, firstPartByteLength))
    .digest("base64");
  const stage = await initiateMultipartBlobStage(runtime, {
    ...owner,
    byteLength: bytes.byteLength,
    firstParts: [
      { byteLength: firstPartByteLength, contentMd5, partNumber: 1 },
    ],
    sha256: sha256Hex(bytes),
  });
  createdStages.push({ runtime, stageId: stage.stageId });
  const createUploadPartUrl = mock(
    async (input: {
      key: string;
      uploadId: string;
      partNumber: number;
      byteLength: number;
      contentMd5: string;
      expiresIn: number;
    }) => ({
      url: `https://storage.test/part?partNumber=${input.partNumber}&signedAt=${Date.now()}`,
      expiresAt: new Date(Date.now() + input.expiresIn * 1000).toISOString(),
    }),
  );
  runtime.blobObjectStore = { ...memory, createUploadPartUrl };
  const route = createMultipartPartUploadRoute({
    requireAuth: authenticated(owner.userId),
    runtime,
  });
  const body = {
    byteLength: firstPartByteLength,
    contentMd5,
    uploadId: stage.uploadId,
  };
  const path = `/blobs/stages/multipart/${stage.stageId}/parts/1/upload`;
  const headers = { "Content-Type": "application/json" };
  return {
    owner,
    runtime,
    memory,
    stage,
    createUploadPartUrl,
    route,
    body,
    path,
    headers,
  };
}

test("part authorization signs only owned stage metadata and disables caching", async () => {
  const f = await fixture();
  const response = await f.route.request(f.path, {
    method: "POST",
    headers: f.headers,
    body: JSON.stringify(f.body),
  });
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(
    MultipartBlobPartUploadResponseSchema.parse(await response.json()),
  ).toMatchObject({
    ...f.body,
    stageId: f.stage.stageId,
    partNumber: 1,
    source: { kind: "signed-url" },
  });
  expect(f.createUploadPartUrl).toHaveBeenCalledWith({
    ...f.body,
    key: `organizations/${f.owner.organizationId}/blob-stages/${f.stage.stageId}`,
    partNumber: 1,
    expiresIn: 300,
  });
});

test("part authorization rejects absent, foreign, expired and completed stages before signing", async () => {
  const f = await fixture();
  const options = {
    method: "POST",
    headers: f.headers,
    body: JSON.stringify(f.body),
  };
  const foreign = createMultipartPartUploadRoute({
    runtime: f.runtime,
    requireAuth: authenticated(crypto.randomUUID()),
  });
  expect((await foreign.request(f.path, options)).status).toBe(403);
  expect(
    (
      await f.route.request(
        f.path.replace(f.stage.stageId, crypto.randomUUID()),
        options,
      )
    ).status,
  ).toBe(404);
  await f.runtime.db
    .update(blobStages)
    .set({ completedAt: new Date() })
    .where(eq(blobStages.id, f.stage.stageId));
  expect((await f.route.request(f.path, options)).status).toBe(409);
  await f.runtime.db
    .update(blobStages)
    .set({ completedAt: null, expiresAt: new Date(0) })
    .where(eq(blobStages.id, f.stage.stageId));
  expect((await f.route.request(f.path, options)).status).toBe(409);
  expect(f.createUploadPartUrl).not.toHaveBeenCalled();
});

test("part authorization bounds identity, size and checksum before signing", async () => {
  const f = await fixture();
  for (const [body, status] of [
    [{ ...f.body, uploadId: "wrong" }, 409],
    [{ ...f.body, byteLength: 13 }, 400],
    [{ ...f.body, byteLength: 0 }, 400],
    [{ ...f.body, byteLength: MAX_MULTIPART_BLOB_PART_BYTES + 1 }, 400],
    [{ ...f.body, contentMd5: "invalid" }, 400],
    [{ ...f.body, key: "arbitrary-object" }, 400],
  ] as const) {
    expect(
      (
        await f.route.request(f.path, {
          method: "POST",
          headers: f.headers,
          body: JSON.stringify(body),
        })
      ).status,
    ).toBe(status);
  }
  for (const part of [0, 2, 10_000, 10_001]) {
    expect(
      (
        await f.route.request(f.path.replace("/parts/1/", `/parts/${part}/`), {
          method: "POST",
          headers: f.headers,
          body: JSON.stringify(f.body),
        })
      ).status,
    ).toBe(400);
  }
  expect(f.createUploadPartUrl).not.toHaveBeenCalled();
});

test("part authorization clamps URL lifetime to the remaining stage lifetime", async () => {
  const f = await fixture();
  const now = Date.now();
  await f.runtime.db
    .update(blobStages)
    .set({ expiresAt: new Date(now + 30_000) })
    .where(eq(blobStages.id, f.stage.stageId));
  const clock = spyOn(Date, "now").mockReturnValue(now);
  try {
    expect(
      (
        await f.route.request(f.path, {
          method: "POST",
          headers: f.headers,
          body: JSON.stringify(f.body),
        })
      ).status,
    ).toBe(200);
    expect(f.createUploadPartUrl.mock.calls[0]?.[0].expiresIn).toBe(30);
    clock.mockReturnValue(now + 29_500);
    expect(
      (
        await f.route.request(f.path, {
          method: "POST",
          headers: f.headers,
          body: JSON.stringify(f.body),
        })
      ).status,
    ).toBe(409);
    expect(f.createUploadPartUrl).toHaveBeenCalledTimes(1);
  } finally {
    clock.mockRestore();
  }
});

test("later chunks receive fresh URLs after five minutes and complete with earlier ETags", async () => {
  const firstPartByteLength = 5 * 1024 * 1024;
  const bytes = new Uint8Array(firstPartByteLength + 6);
  bytes.set(new TextEncoder().encode("part-2"), firstPartByteLength);
  const firstPart = bytes.subarray(0, firstPartByteLength);
  const f = await fixture(bytes, firstPartByteLength);
  const first = MultipartBlobPartUploadResponseSchema.parse(
    await (
      await f.route.request(f.path, {
        method: "POST",
        headers: f.headers,
        body: JSON.stringify(f.body),
      })
    ).json(),
  );
  const key = `organizations/${f.owner.organizationId}/blob-stages/${f.stage.stageId}`;
  const part1 = await f.memory.uploadPart({
    key,
    uploadId: f.stage.uploadId,
    partNumber: 1,
    body: {
      bytes: firstPart,
      byteLength: firstPart.byteLength,
      sha256: sha256Hex(firstPart),
    },
  });
  const clock = spyOn(Date, "now").mockReturnValue(Date.now() + 301_000);
  try {
    const response = await f.route.request(
      f.path.replace("/parts/1/", "/parts/2/"),
      {
        method: "POST",
        headers: f.headers,
        body: JSON.stringify({
          ...f.body,
          byteLength: 6,
          contentMd5: createHash("md5").update("part-2").digest("base64"),
        }),
      },
    );
    expect(response.status).toBe(200);
    const second = MultipartBlobPartUploadResponseSchema.parse(
      await response.json(),
    );
    expect(second.uploadId).toBe(first.uploadId);
    if (
      first.source.kind !== "signed-url" ||
      second.source.kind !== "signed-url"
    )
      throw new Error("Expected signed uploads");
    expect(Date.parse(first.source.expiresAt)).toBeLessThan(Date.now());
    expect(Date.parse(second.source.expiresAt)).toBeGreaterThan(Date.now());
    expect(second.source.url).not.toBe(first.source.url);
    expect(
      (
        await getMultipartBlobStage(f.runtime, {
          stageId: f.stage.stageId,
          userId: f.owner.userId,
        })
      ).uploadedParts,
    ).toEqual([part1]);
    const part2 = await f.memory.uploadPart({
      key,
      uploadId: f.stage.uploadId,
      partNumber: 2,
      body: {
        bytes: new TextEncoder().encode("part-2"),
        byteLength: 6,
        sha256: sha256Hex("part-2"),
      },
    });
    expect(part2.partNumber).toBe(2);
    await completeStageAsBind(f.runtime, {
      stageId: f.stage.stageId,
      userId: f.owner.userId,
    });
    expect(
      await getMultipartBlobStage(f.runtime, {
        stageId: f.stage.stageId,
        userId: f.owner.userId,
      }),
    ).toMatchObject({
      byteLength: bytes.byteLength,
      completed: true,
      sha256: sha256Hex(bytes),
    });
  } finally {
    clock.mockRestore();
  }
});

test("unsigned stores use byte transport while S3 byte proxy requests fail before reading", async () => {
  const f = await fixture();
  const memoryRuntime: ApiServiceRuntime = {
    ...f.runtime,
    blobObjectStore: f.memory,
  };
  const memoryRoute = createMultipartPartUploadRoute({
    runtime: memoryRuntime,
    requireAuth: authenticated(f.owner.userId),
  });
  const response = await memoryRoute.request(f.path, {
    method: "POST",
    headers: f.headers,
    body: JSON.stringify(f.body),
  });
  expect(
    MultipartBlobPartUploadResponseSchema.parse(await response.json()).source,
  ).toEqual({ kind: "api" });
  const app = createRouteApp({
    runtime: f.runtime,
    requireAuth: authenticated(f.owner.userId),
  });
  const uploadPart = mock(f.memory.uploadPart);
  f.runtime.blobObjectStore = { ...f.runtime.blobObjectStore, uploadPart };
  const proxy = await app.request(f.path.replace("/upload", "/bytes"), {
    method: "PUT",
    headers: {
      "Content-Type": "application/octet-stream",
      "X-Tearleads-Blob-Part-Byte-Length": "6",
      "X-Tearleads-Blob-Part-Sha256": sha256Hex("part-1"),
      "X-Tearleads-Blob-Upload-Id": f.stage.uploadId,
    },
    body: new ReadableStream(
      {
        pull() {
          throw new Error("Must not read proxied body");
        },
      },
      { highWaterMark: 0 },
    ),
  });
  expect(proxy.status).toBe(409);
  await expect(
    uploadMultipartBlobPartBytes(f.runtime, {
      byteLength: 6,
      bytes: new TextEncoder().encode("part-1"),
      partNumber: 1,
      sha256: sha256Hex("part-1"),
      stageId: f.stage.stageId,
      uploadId: f.stage.uploadId,
      userId: f.owner.userId,
    }),
  ).rejects.toThrow("Direct multipart uploads are required");
  expect(uploadPart).not.toHaveBeenCalled();
});

test("part authorization requires authentication before input validation", async () => {
  const route = createMultipartPartUploadRoute({
    runtime: createServiceTestRuntime(),
    requireAuth,
  });
  expect(
    (
      await route.request("/blobs/stages/multipart/invalid/parts/0/upload", {
        method: "POST",
        body: "invalid",
      })
    ).status,
  ).toBe(401);
});
