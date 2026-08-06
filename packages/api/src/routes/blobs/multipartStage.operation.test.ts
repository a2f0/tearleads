import { expect, test } from "bun:test";
import {
  blobWireHeaderNames,
  completeMultipartBlobStageOperation,
  getMultipartBlobStageOperation,
  initiateMultipartBlobStageOperation,
  operationRoutePath,
  uploadMultipartBlobPartBytesOperation,
} from "@tearleads/validators/operation";
import type { MiddlewareHandler } from "hono";
import type { SessionEnv } from "../../middleware/session";
import type { ApiServiceRuntime } from "../../services/runtime";
import { createMultipartBlobStageRoute } from "./multipartStage";

const stageId = "11111111-1111-4111-8111-111111111111";

function createRoute(requireAuth: MiddlewareHandler<SessionEnv>) {
  return createMultipartBlobStageRoute({
    requireAuth,
    runtime: {} as ApiServiceRuntime,
  });
}

test("multipart control routes register from shared operations", () => {
  const route = createRoute((_c, next) => next());

  for (const operation of [
    initiateMultipartBlobStageOperation,
    getMultipartBlobStageOperation,
    completeMultipartBlobStageOperation,
    uploadMultipartBlobPartBytesOperation,
  ]) {
    expect(route.routes).toContainEqual(
      expect.objectContaining({
        method: operation.method,
        path: operationRoutePath(operation),
      }),
    );
  }
});

test("multipart control routes authenticate before boundary parsing", async () => {
  const route = createRoute(async (c) =>
    c.json({ error: "Unauthorized" }, 401),
  );
  const responses = await Promise.all([
    route.request("/blobs/stages/multipart", {
      body: "{}",
      headers: { "Content-Type": "application/json" },
      method: initiateMultipartBlobStageOperation.method,
    }),
    route.request("/blobs/stages/multipart/invalid", {
      method: getMultipartBlobStageOperation.method,
    }),
    route.request("/blobs/stages/multipart/invalid/parts/0/bytes", {
      method: uploadMultipartBlobPartBytesOperation.method,
    }),
  ]);

  for (const response of responses) {
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  }
});

test("multipart control routes reject invalid inputs at the boundary", async () => {
  const route = createRoute((_c, next) => next());
  const initiate = await route.request("/blobs/stages/multipart", {
    body: "{}",
    headers: { "Content-Type": "application/json" },
    method: initiateMultipartBlobStageOperation.method,
  });
  const status = await route.request("/blobs/stages/multipart/invalid", {
    method: getMultipartBlobStageOperation.method,
  });
  const completePath = await route.request(
    "/blobs/stages/multipart/invalid/complete",
    {
      body: JSON.stringify({
        parts: [{ etag: "etag-1", partNumber: 1 }],
        uploadId: "upload-1",
      }),
      headers: { "Content-Type": "application/json" },
      method: completeMultipartBlobStageOperation.method,
    },
  );
  const completeBody = await route.request(
    `/blobs/stages/multipart/${stageId}/complete`,
    {
      body: "{}",
      headers: { "Content-Type": "application/json" },
      method: completeMultipartBlobStageOperation.method,
    },
  );
  const uploadPath = await route.request(
    "/blobs/stages/multipart/invalid/parts/1/bytes",
    {
      body: "bytes",
      headers: {
        "Content-Type": "application/octet-stream",
        [blobWireHeaderNames.partByteLength]: "5",
        [blobWireHeaderNames.partSha256]: "a".repeat(64),
        [blobWireHeaderNames.partUploadId]: "upload-1",
      },
      method: uploadMultipartBlobPartBytesOperation.method,
    },
  );
  const uploadHeaders = await route.request(
    `/blobs/stages/multipart/${stageId}/parts/1/bytes`,
    {
      body: "bytes",
      headers: { "Content-Type": "application/octet-stream" },
      method: uploadMultipartBlobPartBytesOperation.method,
    },
  );

  for (const response of [
    initiate,
    status,
    completePath,
    completeBody,
    uploadPath,
    uploadHeaders,
  ]) {
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid request" });
  }
});

test("multipart complete preserves malformed JSON behavior", async () => {
  const route = createRoute((_c, next) => next());
  const response = await route.request(
    `/blobs/stages/multipart/${stageId}/complete`,
    {
      body: "{",
      headers: { "Content-Type": "application/json" },
      method: completeMultipartBlobStageOperation.method,
    },
  );

  expect(response.status).toBe(400);
  expect(await response.text()).toBe("Malformed JSON in request body");
});
