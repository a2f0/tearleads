import { expect, test } from "bun:test";
import { ApiClient } from "@tearleads/api-client";
import { documentSyncOperation } from "@tearleads/validators/operation";
import type { DocumentSyncRequest } from "@tearleads/validators/request";
import {
  DOCUMENT_NOT_FOUND_ERROR_CODE,
  DOCUMENT_SYNC_ERROR_CODES,
} from "@tearleads/validators/response";
import {
  isRetryableDocumentSyncConflict,
  isUpstreamDeletedDocumentSyncFailure,
} from "../../data/documents/shared/responses";
import type { DocumentSyncSubmitFailure } from "../../data/documents/shared/types";
import { isRecoverableDocumentUpdateIdConflict } from "./syncFailureClassification";

function failure(
  code: string | undefined,
  message: string,
  status = 409,
): DocumentSyncSubmitFailure {
  return {
    ...(code === undefined ? {} : { code }),
    message,
    ok: false,
    report: () => undefined,
    status,
  };
}

const READ_ONLY_SYNC_REQUEST: DocumentSyncRequest = {
  contentKeyEpoch: 1,
  expectedLinkSetManifestHash: "manifest-hash",
  expectedTargetHash: "target-hash",
  localVersionVector: null,
  outgoingUpdates: [],
  supportsPullPagination: true,
};

function parsedFailureCode(input: {
  code: unknown;
  error: unknown;
  status: number;
}): string | undefined {
  if (input.status >= 200 && input.status < 300) return undefined;
  return typeof input.error === "string" &&
    input.error.trim().length > 0 &&
    typeof input.code === "string" &&
    input.code.length > 0
    ? input.code
    : undefined;
}

test("document sync stale-state retries depend on status and code", () => {
  expect(
    isRetryableDocumentSyncConflict(
      failure(DOCUMENT_SYNC_ERROR_CODES.stateStale, "Diagnostic changed"),
    ),
  ).toBe(true);
  expect(
    isRetryableDocumentSyncConflict(
      failure(` ${DOCUMENT_SYNC_ERROR_CODES.stateStale} `, "Diagnostic"),
    ),
  ).toBe(false);
  expect(
    isRetryableDocumentSyncConflict(
      failure(DOCUMENT_SYNC_ERROR_CODES.stateStale, "Diagnostic changed", 503),
    ),
  ).toBe(false);
});

test("code-less stale conflicts fail closed — messages are diagnostics, not contract", () => {
  expect(
    isRetryableDocumentSyncConflict(
      failure(undefined, "Document content-key bundle is stale"),
    ),
  ).toBe(false);
  expect(
    isRetryableDocumentSyncConflict(
      failure(undefined, "authorizingContainerPath[1] is stale"),
    ),
  ).toBe(false);
  expect(
    isRetryableDocumentSyncConflict(failure(undefined, "Terminal conflict")),
  ).toBe(false);
  expect(
    isRetryableDocumentSyncConflict(
      failure("unknown_code", "Document KEK targets are stale"),
    ),
  ).toBe(false);
});

test("document update recovery depends on status and code", () => {
  expect(
    isRecoverableDocumentUpdateIdConflict(
      failure(DOCUMENT_SYNC_ERROR_CODES.updateIdConflict, "Different words"),
    ),
  ).toBe(true);
  expect(
    isRecoverableDocumentUpdateIdConflict(
      failure("unknown_code", "Document update id conflict"),
    ),
  ).toBe(false);
  expect(
    isRecoverableDocumentUpdateIdConflict(
      failure(DOCUMENT_SYNC_ERROR_CODES.updateIdConflict, "Words", 500),
    ),
  ).toBe(false);
});

test("code-less update id conflicts fail closed — messages are diagnostics, not contract", () => {
  expect(
    isRecoverableDocumentUpdateIdConflict(
      failure(undefined, "Document update id conflict"),
    ),
  ).toBe(false);
  expect(
    isRecoverableDocumentUpdateIdConflict(failure(undefined, "Other words")),
  ).toBe(false);
});

test("upstream deletion requires the exact status AND coded signal", () => {
  expect(
    isUpstreamDeletedDocumentSyncFailure(
      failure(DOCUMENT_NOT_FOUND_ERROR_CODE, "Document not found", 404),
    ),
  ).toBe(true);
});

test("the destructive wipe gate fails closed on every uncoded 404 — NO legacy fallback", () => {
  // Deliberate strictness: a pre-coded API's genuine deletion fails closed
  // until the coded API deploys. Do NOT add a message fallback here — a bare
  // 404 (proxy/tunnel error page, deploy-skew route miss, container-level
  // lookup) must never authorize deleting the local document and its
  // not-yet-pushed edits.
  expect(
    isUpstreamDeletedDocumentSyncFailure(
      failure(undefined, "Document not found", 404),
    ),
  ).toBe(false);
  expect(
    isUpstreamDeletedDocumentSyncFailure(
      failure(undefined, "<html>404 page</html>", 404),
    ),
  ).toBe(false);
  expect(
    isUpstreamDeletedDocumentSyncFailure(
      failure("unknown_code", "Document not found", 404),
    ),
  ).toBe(false);
  expect(
    isUpstreamDeletedDocumentSyncFailure(
      failure(DOCUMENT_NOT_FOUND_ERROR_CODE, "Document not found", 409),
    ),
  ).toBe(false);
});

test("HTTP response fields exhaustively preserve exact sync status/code mappings", async () => {
  const statuses = [200, ...documentSyncOperation.failureStatuses] as const;
  const codes: readonly unknown[] = [
    undefined,
    null,
    false,
    0,
    {},
    [],
    "",
    " ",
    DOCUMENT_NOT_FOUND_ERROR_CODE,
    ` ${DOCUMENT_NOT_FOUND_ERROR_CODE}`,
    `${DOCUMENT_NOT_FOUND_ERROR_CODE} `,
    DOCUMENT_NOT_FOUND_ERROR_CODE.toUpperCase(),
    ...Object.values(DOCUMENT_SYNC_ERROR_CODES),
    ` ${DOCUMENT_SYNC_ERROR_CODES.stateStale} `,
    "unknown_code",
  ];
  const errors: readonly unknown[] = [
    undefined,
    null,
    false,
    0,
    {},
    [],
    "",
    " ",
    "Diagnostic text is not authority",
    " Document not found ",
  ];
  const previousFetch = globalThis.fetch;
  let nextResponse = new Response(null, { status: 500 });
  globalThis.fetch = Object.assign(async () => nextResponse, {
    preconnect: previousFetch.preconnect,
  });
  const apiClient = new ApiClient("https://api.example.test");
  const mismatches: unknown[] = [];

  try {
    for (const status of statuses) {
      for (const code of codes) {
        for (const error of errors) {
          nextResponse = new Response(JSON.stringify({ code, error }), {
            headers: { "content-type": "application/json" },
            status,
            statusText: "Fuzzed",
          });
          const result = await apiClient.syncDocumentResult(
            "document-failure-matrix",
            READ_ONLY_SYNC_REQUEST,
            { reportErrors: false },
          );
          if (result.ok) {
            mismatches.push({
              code,
              error,
              reason: "unexpected success",
              status,
            });
            continue;
          }

          const expectedCode = parsedFailureCode({ code, error, status });
          const expected = {
            deleteLocalDocument:
              status === 404 && expectedCode === DOCUMENT_NOT_FOUND_ERROR_CODE,
            recoverUpdateId:
              status === 409 &&
              expectedCode === DOCUMENT_SYNC_ERROR_CODES.updateIdConflict,
            retryStaleState:
              status === 409 &&
              expectedCode === DOCUMENT_SYNC_ERROR_CODES.stateStale,
          };
          const actual = {
            deleteLocalDocument: isUpstreamDeletedDocumentSyncFailure(result),
            recoverUpdateId: isRecoverableDocumentUpdateIdConflict(result),
            retryStaleState: isRetryableDocumentSyncConflict(result),
          };
          if (
            result.code !== expectedCode ||
            result.status !== status ||
            actual.deleteLocalDocument !== expected.deleteLocalDocument ||
            actual.recoverUpdateId !== expected.recoverUpdateId ||
            actual.retryStaleState !== expected.retryStaleState
          ) {
            mismatches.push({
              actual,
              code,
              error,
              expected,
              expectedCode,
              resultCode: result.code,
              resultStatus: result.status,
              status,
            });
          }
        }
      }
    }
  } finally {
    globalThis.fetch = previousFetch;
  }

  expect(mismatches).toEqual([]);
});
