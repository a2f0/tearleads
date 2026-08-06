import { expect, test } from "bun:test";
import Ajv2020 from "ajv/dist/2020";
import {
  DocumentEditAttributionResponseSchema,
  ErrorResponseSchema,
  ListDocumentEditAttributionRangesResponseSchema,
} from "../response";
import {
  operationRequestPath,
  operationRequestPathWithQuery,
  operationRoutePath,
} from "./definition";
import {
  documentAttributionWireHeaderKeys,
  getDocumentAttributionOperation,
  listDocumentAttributionRangesOperation,
} from "./documentAttribution";
import { openApiDocument } from "./openApi";

const documentId = "document/with spaces";

test("document attribution operations own their HTTP contracts", () => {
  expect(getDocumentAttributionOperation).toMatchObject({
    auth: "session",
    emptyResponseStatuses: [304],
    failureStatuses: [400, 401, 403, 404, 409, 500],
    id: "documents.attribution.get",
    method: "GET",
    responses: { 200: DocumentEditAttributionResponseSchema },
  });
  expect(listDocumentAttributionRangesOperation).toMatchObject({
    auth: "session",
    failureStatuses: [400, 401, 403, 404, 409, 500],
    id: "documents.attribution.ranges.list",
    method: "GET",
    responses: { 200: ListDocumentEditAttributionRangesResponseSchema },
  });
  for (const operation of [
    getDocumentAttributionOperation,
    listDocumentAttributionRangesOperation,
  ]) {
    expect(operation.failureResponses).toEqual({
      400: ErrorResponseSchema,
      401: ErrorResponseSchema,
      403: ErrorResponseSchema,
      404: ErrorResponseSchema,
      409: ErrorResponseSchema,
      500: ErrorResponseSchema,
    });
  }
});

test("document attribution paths and query strings derive from shared schemas", () => {
  expect(operationRoutePath(getDocumentAttributionOperation)).toBe(
    "/documents/:documentId/attribution",
  );
  expect(
    operationRequestPath(getDocumentAttributionOperation, { documentId }),
  ).toBe("/documents/document%2Fwith%20spaces/attribution");
  expect(
    operationRequestPathWithQuery(
      listDocumentAttributionRangesOperation,
      { documentId },
      { cursor: "page one", expectedRevision: 7, limit: 25 },
    ),
  ).toBe(
    "/documents/document%2Fwith%20spaces/attribution/ranges?cursor=page+one&expectedRevision=7&limit=25",
  );
});

test("attribution range query validation preserves boundary messages", () => {
  const query = listDocumentAttributionRangesOperation.query;
  expect(query.safeParse({ expectedRevision: "7", limit: "25" }).success).toBe(
    true,
  );

  const invalidExpectedRevision = query.safeParse({
    expectedRevision: "not-a-number",
  });
  expect(invalidExpectedRevision.success).toBe(false);
  if (!invalidExpectedRevision.success) {
    expect(invalidExpectedRevision.error.issues[0]?.message).toBe(
      "Document attribution expected revision is invalid",
    );
  }

  const invalidLimit = query.safeParse({ limit: "0" });
  expect(invalidLimit.success).toBe(false);
  if (!invalidLimit.success) {
    expect(invalidLimit.error.issues[0]?.message).toBe(
      "Document attribution range limit must be between 1 and 500",
    );
  }
});

test("document attribution OpenAPI documents caching, pagination, and errors", () => {
  const compact =
    openApiDocument.paths["/documents/{documentId}/attribution"]?.get;
  const ranges =
    openApiDocument.paths["/documents/{documentId}/attribution/ranges"]?.get;
  if (compact === undefined || ranges === undefined) {
    throw new Error("Document attribution OpenAPI operations are missing");
  }

  expect(Object.keys(compact.responses)).toEqual([
    "200",
    "304",
    "400",
    "401",
    "403",
    "404",
    "409",
    "500",
  ]);
  expect(compact.responses["304"]?.content).toBeUndefined();
  expect(compact.responses["304"]?.headers).toHaveProperty(
    documentAttributionWireHeaderKeys.etag,
  );
  expect(
    ranges.parameters.find(
      (parameter) => Reflect.get(parameter, "name") === "limit",
    ),
  ).toMatchObject({
    in: "query",
    schema: { maximum: 500, minimum: 1, type: "integer" },
  });
  expect(ranges.responses["200"]?.headers).toHaveProperty(
    documentAttributionWireHeaderKeys.cacheControl,
  );
});

test("counter ordering remains an explicit runtime refinement", () => {
  const compact =
    openApiDocument.paths["/documents/{documentId}/attribution"]?.get;
  const responseSchema =
    compact?.responses["200"]?.content?.["application/json"]?.schema;
  if (responseSchema === undefined) {
    throw new Error("Document attribution response schema is missing");
  }
  const input = {
    attributionRevision: 1,
    documentId: "document-1",
    segments: [
      {
        authorityKind: "direct",
        endCounter: 1,
        peerId: "peer-1",
        startCounter: 2,
        writerKeyFingerprint: "fingerprint-1",
        writerUserId: "user-1",
      },
    ],
  };

  expect(new Ajv2020({ strict: true }).compile(responseSchema)(input)).toBe(
    true,
  );
  expect(DocumentEditAttributionResponseSchema.safeParse(input).success).toBe(
    false,
  );
});
