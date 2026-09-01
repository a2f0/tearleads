import { expect, test } from "bun:test";
import {
  bindBlobAttachmentOperation,
  detachBlobAttachmentOperation,
} from "@tearleads/validators/operation";
import { bindBlobAttachment, detachBlobAttachment } from "./attachments";

test("blob attachment client metadata derives from shared operations", () => {
  expect(bindBlobAttachment).toMatchObject({
    method: bindBlobAttachmentOperation.method,
  });
  expect(detachBlobAttachment).toMatchObject({
    method: detachBlobAttachmentOperation.method,
  });
  expect(bindBlobAttachment.path("blob/1")).toBe(
    "/blobs/blob%2F1/attachment-bindings",
  );
  expect(detachBlobAttachment.path("blob/1", "binding/1")).toBe(
    "/blobs/blob%2F1/attachment-bindings/binding%2F1/detach",
  );
  expect(bindBlobAttachment.isRequest).toBeDefined();
  expect(bindBlobAttachment.isResponse).toBeDefined();
  expect(detachBlobAttachment.isRequest).toBeDefined();
  expect(detachBlobAttachment.isResponse).toBeDefined();
});
