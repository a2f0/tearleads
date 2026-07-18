import { expect, test } from "bun:test";
import { DOCUMENT_SYNC_ERROR_CODES } from "@tearleads/validators/response";
import { isRetryableDocumentSyncConflict } from "../../data/documents/shared/responses";
import type { DocumentSyncSubmitFailure } from "../../data/documents/shared/types";
import { isRecoverableDocumentUpdateIdConflict } from "./syncFailures";

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

test("code-less stale conflicts fall back to legacy messages (#1607)", () => {
  expect(
    isRetryableDocumentSyncConflict(
      failure(undefined, "Document content-key bundle is stale"),
    ),
  ).toBe(true);
  expect(
    isRetryableDocumentSyncConflict(
      failure(undefined, "authorizingContainerPath[1] is stale"),
    ),
  ).toBe(true);
  expect(
    isRetryableDocumentSyncConflict(failure(undefined, "Terminal conflict")),
  ).toBe(false);
  // A present-but-unknown code fails closed even over a legacy message.
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

test("code-less update id conflicts fall back to the message (#1607)", () => {
  expect(
    isRecoverableDocumentUpdateIdConflict(
      failure(undefined, "Document update id conflict"),
    ),
  ).toBe(true);
  expect(
    isRecoverableDocumentUpdateIdConflict(failure(undefined, "Other words")),
  ).toBe(false);
});
