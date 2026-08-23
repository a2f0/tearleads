import { expect, test } from "bun:test";
import {
  createDocumentOperation,
  deleteDocumentOperation,
  documentSyncOperation,
  linkDocumentOperation,
  operationRoutePath,
  unlinkDocumentOperation,
} from "@symcrypt/validators/operation";
import { MAX_DOCUMENT_SYNC_REQUEST_BYTES } from "@symcrypt/validators/util";
import type { MiddlewareHandler } from "hono";
import type { SessionEnv } from "../../middleware/session";
import type { ApiServiceRuntime } from "../../services/runtime";
import { createDocumentMutationsRoute } from "./mutations";

function createTestRoute(requireAuth: MiddlewareHandler<SessionEnv>) {
  return createDocumentMutationsRoute({
    publish: async () => undefined,
    requireAuth,
    runtime: {} as ApiServiceRuntime,
  });
}

const documentOperations = [
  createDocumentOperation,
  deleteDocumentOperation,
  documentSyncOperation,
  linkDocumentOperation,
  unlinkDocumentOperation,
] as const;

test("document mutation routes register from shared operations", () => {
  const route = createTestRoute((_c, next) => next());

  for (const operation of documentOperations) {
    expect(
      route.routes.some(
        ({ method, path }) =>
          method === operation.method && path === operationRoutePath(operation),
      ),
    ).toBe(true);
  }
});

test("document mutations authenticate before boundary parsing", async () => {
  const route = createTestRoute(async (c) =>
    c.json({ error: "Unauthorized" }, 401),
  );
  const response = await route.request("/documents/document-1/link", {
    body: "{}",
    headers: { "Content-Type": "application/json" },
    method: linkDocumentOperation.method,
  });

  expect(response.status).toBe(401);
  expect(await response.json()).toEqual({ error: "Unauthorized" });
});

test("document mutations reject invalid bodies at the HTTP boundary", async () => {
  const route = createTestRoute((_c, next) => next());
  const requests = [
    route.request("/documents", {
      body: "{}",
      headers: { "Content-Type": "application/json" },
      method: createDocumentOperation.method,
    }),
    route.request("/documents/document-1/link", {
      body: "{}",
      headers: { "Content-Type": "application/json" },
      method: linkDocumentOperation.method,
    }),
    route.request("/documents/document-1/unlink", {
      body: "{}",
      headers: { "Content-Type": "application/json" },
      method: unlinkDocumentOperation.method,
    }),
  ];

  for (const request of requests) {
    const response = await request;
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid request" });
  }
});

test("document sync preserves the invalid-request response", async () => {
  const route = createTestRoute((_c, next) => next());
  const response = await route.request("/documents/document-1/sync", {
    body: "{}",
    headers: {
      "Content-Length": "2",
      "Content-Type": "application/json",
    },
    method: documentSyncOperation.method,
  });

  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: "Invalid request" });
});

test("document sync requires a bounded body length before parsing", async () => {
  const route = createTestRoute((_c, next) => next());
  const chunk = new Uint8Array(1024 * 1024);
  let remainingBytes = MAX_DOCUMENT_SYNC_REQUEST_BYTES + 1;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (remainingBytes === 0) {
        controller.close();
        return;
      }

      const byteLength = Math.min(remainingBytes, chunk.byteLength);
      controller.enqueue(chunk.subarray(0, byteLength));
      remainingBytes -= byteLength;
    },
  });
  const request = new Request("http://localhost/documents/document-1/sync", {
    body,
    headers: { "Content-Type": "application/json" },
    method: documentSyncOperation.method,
  });
  expect(request.headers.has("Content-Length")).toBe(false);

  const response = await route.request(request);

  expect(response.status).toBe(411);
  expect(await response.json()).toEqual({ error: "Content-Length required" });
});

test("document sync rejects oversized declared bodies before parsing", async () => {
  const route = createTestRoute((_c, next) => next());
  const response = await route.request("/documents/document-1/sync", {
    body: "{}",
    headers: {
      "Content-Length": String(MAX_DOCUMENT_SYNC_REQUEST_BYTES + 1),
      "Content-Type": "application/json",
    },
    method: documentSyncOperation.method,
  });

  expect(response.status).toBe(413);
  expect(await response.json()).toEqual({ error: "Request body too large" });
});

test("document mutations preserve malformed JSON behavior", async () => {
  const route = createTestRoute((_c, next) => next());
  const response = await route.request("/documents", {
    body: "{",
    headers: { "Content-Type": "application/json" },
    method: createDocumentOperation.method,
  });

  expect(response.status).toBe(400);
  expect(await response.text()).toBe("Malformed JSON in request body");
});
