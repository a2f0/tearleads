import { expect, test } from "bun:test";
import {
  DocumentBaselineStageOpenRequestSchema,
  DocumentBaselineStageWriteHeaderRequestSchema,
} from "../request";
import { DocumentSyncOutgoingUpdateSchema } from "../request/documentSyncSchema";
import {
  DOCUMENT_BASELINE_STAGE_ERROR_CODES,
  DocumentBaselineStageAbandonResponseSchema,
  DocumentBaselineStageConflictErrorResponseSchema,
  DocumentBaselineStageNotFoundErrorResponseSchema,
  DocumentBaselineStageStatusResponseSchema,
  DocumentMutationFailureResponseSchema,
  DocumentSyncErrorResponseSchema,
  isDocumentBaselineStageErrorCode,
} from "../response";
import { ErrorResponseSchema } from "../response/error";
import {
  DOCUMENT_BASELINE_STAGE_BUSY_RETRY_AFTER_SECONDS,
  DOCUMENT_BASELINE_STAGE_IDLE_SECONDS,
  DOCUMENT_BASELINE_STAGE_MAX_SECONDS,
  MAX_DOCUMENT_BASELINE_SEGMENT_HEADER_REQUEST_BYTES,
  MAX_DOCUMENT_BASELINE_SEGMENT_REQUEST_BYTES,
  MAX_DOCUMENT_BASELINE_SEGMENTS,
  MAX_DOCUMENT_BASELINE_STAGE_BYTES,
  MAX_DOCUMENT_BASELINE_STAGE_SPANS,
  MAX_DOCUMENT_STAGED_BASELINE_SEGMENTS,
  MAX_DOCUMENT_SYNC_AUTHORIZATION_PATH_REFS,
  MAX_DOCUMENT_SYNC_REQUEST_BYTES,
  MAX_OPEN_DOCUMENT_BASELINE_STAGES_PER_USER,
  MAX_WRITE_HEADER_WRITER_DEVICE_ID_LENGTH,
} from "../util";
import { operationRequestPath, operationRoutePath } from "./definition";
import {
  abandonDocumentBaselineStageOperation,
  DocumentBaselineStagePathParamsSchema,
  DocumentBaselineStageSegmentPathParamsSchema,
  DocumentBaselineStagesPathParamsSchema,
  getDocumentBaselineStageOperation,
  openDocumentBaselineStageOperation,
  resignDocumentBaselineSegmentHeaderOperation,
  stageDocumentBaselineSegmentOperation,
} from "./documentBaselineStages";
import type { operations, paths } from "./generatedOpenApi";
import { operationResponseHeaderNames } from "./headerNames";
import { openApiDocument } from "./openApi";
import { protocolOperations } from "./registry";

const documentId = "11111111-1111-4111-8111-111111111111";
const baselineId = "22222222-2222-4222-8222-222222222222";

test("the staged baseline bounds are the published ones", () => {
  expect(MAX_DOCUMENT_BASELINE_SEGMENTS).toBe(64);
  expect(MAX_DOCUMENT_STAGED_BASELINE_SEGMENTS).toBe(4096);
  expect(MAX_DOCUMENT_BASELINE_SEGMENT_REQUEST_BYTES).toBe(
    MAX_DOCUMENT_SYNC_REQUEST_BYTES,
  );
  expect(DOCUMENT_BASELINE_STAGE_IDLE_SECONDS).toBe(3600);
  expect(DOCUMENT_BASELINE_STAGE_MAX_SECONDS).toBe(86_400);
  expect(MAX_DOCUMENT_BASELINE_STAGE_BYTES).toBe(1024 * 1024 * 1024);
  expect(MAX_DOCUMENT_BASELINE_STAGE_SPANS).toBe(1_048_576);
  expect(MAX_OPEN_DOCUMENT_BASELINE_STAGES_PER_USER).toBe(4);
  expect(MAX_DOCUMENT_BASELINE_SEGMENT_HEADER_REQUEST_BYTES).toBe(512 * 1024);
  expect(MAX_WRITE_HEADER_WRITER_DEVICE_ID_LENGTH).toBe(128);
  // A re-signed header's request admits the widest header a document write
  // signs: its citations at 67 serialized bytes each, with room to spare.
  expect(
    MAX_DOCUMENT_SYNC_AUTHORIZATION_PATH_REFS * 67 + 32 * 1024,
  ).toBeLessThan(MAX_DOCUMENT_BASELINE_SEGMENT_HEADER_REQUEST_BYTES);
});

// The baseline digest and every signed header are rooted in the ids as
// their signers spell them, lower-case. A stage route reads no other
// spelling, so no stage is ever opened or staged to under one.
test("a stage path names its document and baseline in canonical form only", () => {
  const schemas = [
    [DocumentBaselineStagesPathParamsSchema, {}],
    [DocumentBaselineStagePathParamsSchema, { baselineId }],
    [
      DocumentBaselineStageSegmentPathParamsSchema,
      { baselineId, segmentIndex: 0 },
    ],
  ] as const;
  for (const [schema, rest] of schemas) {
    const parses = (params: object) =>
      schema.safeParse({ ...rest, documentId, ...params }).success;
    expect(parses({})).toBe(true);
    for (const params of [
      { documentId: documentId.replace("1111-4111", "abcd-4abc") },
      ...("baselineId" in rest
        ? [{ baselineId: baselineId.replace("2222-4222", "abcd-4abc") }]
        : []),
    ]) {
      expect([params, parses(params)]).toEqual([params, true]);
      const upper = Object.fromEntries(
        Object.entries(params).map(([key, id]) => [key, id.toUpperCase()]),
      );
      expect([upper, parses(upper)]).toEqual([upper, false]);
    }
    for (const id of ["", "document", `{${documentId}}`, ` ${documentId}`]) {
      expect([id, parses({ documentId: id })]).toEqual([id, false]);
    }
  }
  const parameters =
    openApiDocument.paths["/documents/{documentId}/baseline-stages"]?.post
      ?.parameters ?? [];
  expect(JSON.stringify(parameters)).toContain("^[0-9a-f]{8}-");
});

test("the stage operations own their HTTP contracts", () => {
  const stage = `/documents/${documentId}/baseline-stages/${baselineId}`;
  const contracts = [
    [
      openDocumentBaselineStageOperation,
      "POST",
      `/documents/${documentId}/baseline-stages`,
      DocumentBaselineStageOpenRequestSchema,
      DocumentBaselineStageStatusResponseSchema,
      { documentId },
    ],
    [
      getDocumentBaselineStageOperation,
      "GET",
      stage,
      undefined,
      DocumentBaselineStageStatusResponseSchema,
      { baselineId, documentId },
    ],
    [
      abandonDocumentBaselineStageOperation,
      "DELETE",
      stage,
      undefined,
      DocumentBaselineStageAbandonResponseSchema,
      { baselineId, documentId },
    ],
    [
      stageDocumentBaselineSegmentOperation,
      "PUT",
      `${stage}/segments/7`,
      DocumentSyncOutgoingUpdateSchema,
      DocumentBaselineStageStatusResponseSchema,
      { baselineId, documentId, segmentIndex: 7 },
    ],
    [
      resignDocumentBaselineSegmentHeaderOperation,
      "PUT",
      `${stage}/segments/7/write-header`,
      DocumentBaselineStageWriteHeaderRequestSchema,
      DocumentBaselineStageStatusResponseSchema,
      { baselineId, documentId, segmentIndex: 7 },
    ],
  ] as const;
  for (const [operation, method, path, body, response, params] of contracts) {
    expect(operation).toMatchObject({ auth: "session", method });
    expect(Reflect.get(operation, "body")).toBe(body);
    expect(operation.responses[200]).toBe(response);
    // Only the coded 404 and the stage's own conflict body are sent.
    expect(operation.failureResponses[404]).toBe(
      DocumentBaselineStageNotFoundErrorResponseSchema,
    );
    expect(operation.failureResponses[409]).toBe(
      DocumentBaselineStageConflictErrorResponseSchema,
    );
    expect(operationRequestPath(operation, params)).toBe(path);
    expect(protocolOperations).toContain(operation);
    expect(
      openApiDocument.paths[operation.path]?.[
        method === "POST"
          ? "post"
          : method === "GET"
            ? "get"
            : method === "PUT"
              ? "put"
              : "delete"
      ]?.operationId,
    ).toBe(operation.id);
  }
  expect(operationRoutePath(stageDocumentBaselineSegmentOperation)).toBe(
    "/documents/:documentId/baseline-stages/:baselineId/segments/:segmentIndex",
  );
  // The two routes that take a body of the writer's size refuse one past
  // their own limit.
  for (const operation of [
    stageDocumentBaselineSegmentOperation,
    resignDocumentBaselineSegmentHeaderOperation,
  ]) {
    expect(operation.failureStatuses).toContain(413);
  }
  expect(openDocumentBaselineStageOperation.failureStatuses).not.toContain(413);
});

// An open does not wait for the caller's own stage on the document: it
// answers 503, which the operation declares with what it means and the
// delay it names, so a generated client knows the status and a browser may
// read the header. No other stage route promises the header.
test("the open operation declares its 503 and the delay it names", () => {
  const open = openDocumentBaselineStageOperation;
  expect(open.failureStatuses).toContain(503);
  expect(open.failureResponses[503]).toBe(ErrorResponseSchema);
  expect(open.responseDescriptions[503]).toContain("did not wait");
  expect(open.description).toContain("returns 503 with `Retry-After`");
  const headers = open.responseHeaders[503];
  const seconds = String(DOCUMENT_BASELINE_STAGE_BUSY_RETRY_AFTER_SECONDS);
  expect(DOCUMENT_BASELINE_STAGE_BUSY_RETRY_AFTER_SECONDS).toBe(1);
  expect(headers.safeParse({ "retry-after": seconds }).success).toBe(true);
  // The outer boundary's 503, for a database it could not reach, names none.
  expect(headers.safeParse({}).success).toBe(true);
  expect(headers.safeParse({ "retry-after": "soon" }).success).toBe(false);
  expect(operationResponseHeaderNames(open, 503)).toEqual(["retry-after"]);

  const documented =
    openApiDocument.paths["/documents/{documentId}/baseline-stages"]?.post
      ?.responses?.["503"];
  expect(documented).toMatchObject({
    description: open.responseDescriptions[503],
    headers: {
      "retry-after": {
        required: false,
        schema: { const: seconds, type: "string" },
      },
    },
  });
  for (const operation of [
    getDocumentBaselineStageOperation,
    abandonDocumentBaselineStageOperation,
    stageDocumentBaselineSegmentOperation,
    resignDocumentBaselineSegmentHeaderOperation,
  ]) {
    expect(operationResponseHeaderNames(operation, 503)).toEqual([]);
  }
});

test("a staged segment's index is every index but the final one's", () => {
  const params = (segmentIndex: unknown) =>
    DocumentBaselineStageSegmentPathParamsSchema.safeParse({
      baselineId,
      documentId,
      segmentIndex,
    }).success;
  const last = MAX_DOCUMENT_STAGED_BASELINE_SEGMENTS - 2;
  for (const index of [0, "0", "7", last, String(last)]) {
    expect([index, params(index)]).toEqual([index, true]);
  }
  for (const index of [
    -1,
    "-1",
    "07",
    "1.5",
    1.5,
    "",
    "seven",
    last + 1,
    String(last + 1),
    "99999",
  ]) {
    expect([index, params(index)]).toEqual([index, false]);
  }
});

test("a stage's refusals are exact codes, and a commit carries them beside its own", () => {
  const codes = Object.values(DOCUMENT_BASELINE_STAGE_ERROR_CODES);
  expect(codes).toHaveLength(10);
  for (const code of codes) {
    expect(code.startsWith("document_baseline_stage_")).toBe(true);
    expect(isDocumentBaselineStageErrorCode(code)).toBe(true);
    // On the routes that commit a stage the code rides beside the route's
    // own, whose set of values does not change.
    expect(
      DocumentSyncErrorResponseSchema.safeParse({
        baselineStageCode: code,
        code: "document_sync_baseline_group_invalid",
        error: "refused",
      }).success,
    ).toBe(true);
    expect(
      DocumentSyncErrorResponseSchema.safeParse({ code, error: "refused" })
        .success,
    ).toBe(false);
    expect(
      DocumentMutationFailureResponseSchema.safeParse({
        code,
        error: "refused",
      }).success,
    ).toBe(false);
  }
  expect(isDocumentBaselineStageErrorCode("multipart_blob_stage_expired")).toBe(
    false,
  );
  expect(
    DocumentSyncErrorResponseSchema.safeParse({
      baselineStageCode: "multipart_blob_stage_expired",
      code: "document_sync_baseline_group_invalid",
      error: "refused",
    }).success,
  ).toBe(false);

  const notFound = DOCUMENT_BASELINE_STAGE_ERROR_CODES.notFound;
  expect(
    DocumentBaselineStageNotFoundErrorResponseSchema.safeParse({
      code: notFound,
      error: "gone",
    }).success,
  ).toBe(true);
  // A 404 without the code proves nothing about the stage.
  expect(
    DocumentBaselineStageNotFoundErrorResponseSchema.safeParse({
      error: "gone",
    }).success,
  ).toBe(false);
  // A conflict is uncoded or carries a stage code; "not found" is the 404's
  // and "headers stale" only a commit's.
  const conflict = (body: object) =>
    DocumentBaselineStageConflictErrorResponseSchema.safeParse(body).success;
  expect(conflict({ error: "raced" })).toBe(true);
  expect(
    conflict({
      code: DOCUMENT_BASELINE_STAGE_ERROR_CODES.segmentOutOfOrder,
      error: "next",
      nextSegmentIndex: 3,
    }),
  ).toBe(true);
  // Every other stage code is a stage route's to send, the two bounds among
  // them.
  for (const code of Object.values(DOCUMENT_BASELINE_STAGE_ERROR_CODES)) {
    expect([code, conflict({ code, error: "refused" })]).toEqual([
      code,
      code !== notFound &&
        code !== DOCUMENT_BASELINE_STAGE_ERROR_CODES.headersStale,
    ]);
  }
  expect(DOCUMENT_BASELINE_STAGE_ERROR_CODES).toMatchObject({
    limitReached: "document_baseline_stage_limit_reached",
    tooLarge: "document_baseline_stage_too_large",
  });
  // A limit refusal names the caller's open stages, as many as one user may
  // hold and no more.
  const openStage = {
    baselineId,
    documentId,
    expiresAt: "2026-01-01T00:00:00.000Z",
  };
  const limit = (openStages: unknown) =>
    conflict({
      code: DOCUMENT_BASELINE_STAGE_ERROR_CODES.limitReached,
      error: "too many",
      openStages,
    });
  expect(
    limit(Array(MAX_OPEN_DOCUMENT_BASELINE_STAGES_PER_USER).fill(openStage)),
  ).toBe(true);
  expect(
    limit(
      Array(MAX_OPEN_DOCUMENT_BASELINE_STAGES_PER_USER + 1).fill(openStage),
    ),
  ).toBe(false);
  expect(limit([{ ...openStage, baselineId: "stage" }])).toBe(false);
  expect(limit([{ baselineId, documentId }])).toBe(false);
  for (const code of [
    notFound,
    DOCUMENT_BASELINE_STAGE_ERROR_CODES.headersStale,
    "document_sync_conflict",
  ]) {
    expect([code, conflict({ code, error: "refused" })]).toEqual([code, false]);
  }
});

type IsEqual<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <
    Value,
  >() => Value extends Right ? 1 : 2
    ? true
    : false;

function assertType<Condition extends true>(_condition?: Condition): void {}

test("generated OpenAPI types carry the stage routes", () => {
  assertType<
    IsEqual<
      paths["/documents/{documentId}/baseline-stages"]["post"],
      operations["documents.baselineStages.open"]
    >
  >();
  assertType<
    IsEqual<
      paths["/documents/{documentId}/baseline-stages/{baselineId}"]["get"],
      operations["documents.baselineStages.get"]
    >
  >();
  assertType<
    IsEqual<
      paths["/documents/{documentId}/baseline-stages/{baselineId}"]["delete"],
      operations["documents.baselineStages.abandon"]
    >
  >();
  assertType<
    IsEqual<
      paths["/documents/{documentId}/baseline-stages/{baselineId}/segments/{segmentIndex}"]["put"],
      operations["documents.baselineStages.segments.stage"]
    >
  >();
  assertType<
    IsEqual<
      paths["/documents/{documentId}/baseline-stages/{baselineId}/segments/{segmentIndex}/write-header"]["put"],
      operations["documents.baselineStages.segments.resign"]
    >
  >();
});
