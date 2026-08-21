import { expect, test } from "bun:test";
import {
  DOCUMENT_NOT_FOUND_ERROR_CODE,
  DOCUMENT_SYNC_ERROR_CODES,
} from "@symcrypt/validators/response";
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
