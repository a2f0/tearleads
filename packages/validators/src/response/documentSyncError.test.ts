import { expect, test } from "bun:test";
import {
  DOCUMENT_SYNC_ERROR_CODES,
  DocumentSyncErrorResponseSchema,
  isDocumentSyncErrorResponse,
} from "./documentSyncError";

test("document sync error schema accepts stable codes and extensions", () => {
  for (const code of Object.values(DOCUMENT_SYNC_ERROR_CODES)) {
    expect(
      isDocumentSyncErrorResponse({ code, error: "Diagnostic", future: true }),
    ).toBe(true);
  }
});

test("document sync error schema rejects incomplete or unknown envelopes", () => {
  expect(isDocumentSyncErrorResponse({ error: "Diagnostic" })).toBe(false);
  expect(
    isDocumentSyncErrorResponse({ code: "unknown", error: "Diagnostic" }),
  ).toBe(false);
  expect(
    DocumentSyncErrorResponseSchema.safeParse({
      code: DOCUMENT_SYNC_ERROR_CODES.conflict,
      error: "",
    }).success,
  ).toBe(false);
});
