import { expect, test } from "bun:test";
import { listDocumentAttachmentsOperation } from "@tearleads/validators/operation";
import { listDocumentAttachments } from "./attachments";

test("document attachment client metadata derives from the shared operation", () => {
  expect(listDocumentAttachments).toMatchObject({
    method: listDocumentAttachmentsOperation.method,
  });
  expect(listDocumentAttachments.path("document/1")).toBe(
    "/documents/document%2F1/attachments",
  );
  expect(listDocumentAttachments.isResponse).toBeDefined();
});
