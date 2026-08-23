import { expect, test } from "bun:test";
import { z } from "zod";
import { DocumentSyncRequestSchema } from "../request";
import {
  DocumentSyncErrorResponseSchema,
  DocumentSyncResponseSchema,
  ErrorResponseSchema,
} from "../response";
import {
  defineJsonOperation,
  operationRequestPath,
  operationRoutePath,
} from "./definition";
import {
  DocumentSyncPathParamsSchema,
  documentSyncOperation,
} from "./documentSync";
import { createOpenApiDocument } from "./openApi";

test("document sync operation owns its HTTP contract metadata", () => {
  expect(documentSyncOperation.id).toBe("documents.sync");
  expect(documentSyncOperation.method).toBe("POST");
  expect(documentSyncOperation.path).toBe("/documents/{documentId}/sync");
  expect(documentSyncOperation.auth).toBe("session");
  expect(documentSyncOperation.failureStatuses).toEqual([
    400, 401, 402, 403, 404, 409, 413, 500, 503,
  ]);
  expect(documentSyncOperation.params).toBe(DocumentSyncPathParamsSchema);
  expect(documentSyncOperation.body).toBe(DocumentSyncRequestSchema);
  expect(documentSyncOperation.failureResponses?.[409]).toBe(
    DocumentSyncErrorResponseSchema,
  );
  expect(documentSyncOperation.failureResponses?.[413]).toBe(
    ErrorResponseSchema,
  );
  expect(documentSyncOperation.responses[200]).toBe(DocumentSyncResponseSchema);
  expect(Object.keys(documentSyncOperation.responses)).toEqual(["200"]);
});

test("operation paths derive server syntax and encoded client URLs", () => {
  expect(operationRoutePath(documentSyncOperation)).toBe(
    "/documents/:documentId/sync",
  );
  expect(
    operationRequestPath(documentSyncOperation, {
      documentId: "document /%雪",
    }),
  ).toBe("/documents/document%20%2F%25%E9%9B%AA/sync");
  expect(() =>
    operationRequestPath(documentSyncOperation, {} as never),
  ).toThrow("Invalid path parameters for documents.sync");
});

test("operation definitions preserve schema identity", () => {
  const schema = z.looseObject({ ok: z.literal(true) });
  const operation = defineJsonOperation({
    auth: "none",
    body: z.unknown(),
    failureStatuses: [],
    id: "test.operation",
    method: "POST",
    params: z.strictObject({ id: z.string() }),
    path: "/test/{id}",
    responses: { 200: schema },
  });

  expect(operation.responses[200]).toBe(schema);
});

test("operation definitions reject bodies for undeclared failure statuses", () => {
  expect(() =>
    createOpenApiDocument([
      defineJsonOperation({
        auth: "none",
        body: z.unknown(),
        failureResponses: { 409: z.object({ error: z.string() }) },
        failureStatuses: [],
        id: "test.invalid-failure",
        method: "POST",
        params: z.strictObject({ id: z.string() }),
        path: "/test/{id}",
        responses: { 200: z.object({ ok: z.literal(true) }) },
      }),
    ]),
  ).toThrow("body for unregistered failure status 409");
});

test("operation definitions reject descriptions for undeclared statuses", () => {
  expect(() =>
    createOpenApiDocument([
      defineJsonOperation({
        auth: "none",
        body: z.unknown(),
        failureStatuses: [],
        id: "test.invalid-description",
        method: "POST",
        params: z.strictObject({ id: z.string() }),
        path: "/test/{id}",
        responseDescriptions: { 409: "Conflict" },
        responses: { 200: z.object({ ok: z.literal(true) }) },
      }),
    ]),
  ).toThrow("description for unregistered response status 409");
});
