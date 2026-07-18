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
      failure(undefined, "Document content-key bundle is stale"),
    ),
  ).toBe(false);
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

test("document update recovery depends on status and code", () => {
  expect(
    isRecoverableDocumentUpdateIdConflict(
      failure(DOCUMENT_SYNC_ERROR_CODES.updateIdConflict, "Different words"),
    ),
  ).toBe(true);
  expect(
    isRecoverableDocumentUpdateIdConflict(
      failure(undefined, "Document update id conflict"),
    ),
  ).toBe(false);
});
