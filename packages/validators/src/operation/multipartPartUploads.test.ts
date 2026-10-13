import { expect, test } from "bun:test";
import { MAX_MULTIPART_BLOB_PART_BYTES } from "../util";
import {
  authorizeMultipartBlobPartUploadOperation,
  MultipartBlobPartUploadRequestSchema,
  MultipartBlobPartUploadResponseSchema,
} from "./multipartPartUploads";

const request = {
  byteLength: 6,
  contentMd5: "AAAAAAAAAAAAAAAAAAAAAA==",
  uploadId: "upload-1",
};
test("multipart upload metadata bounds size and requires canonical MD5", () => {
  expect(MultipartBlobPartUploadRequestSchema.safeParse(request).success).toBe(
    true,
  );
  for (const byteLength of [0, -1, 1.5, MAX_MULTIPART_BLOB_PART_BYTES + 1]) {
    expect(
      MultipartBlobPartUploadRequestSchema.safeParse({ ...request, byteLength })
        .success,
    ).toBe(false);
  }
  for (const contentMd5 of [
    "",
    "a".repeat(32),
    "AAAAAAAAAAAAAAAAAAAAAB==",
    "AAAAAAAAAAAAAAAAAAAAAA",
    "AAAAAAAAAAAAAAAAAAAAAA==\n",
  ]) {
    expect(
      MultipartBlobPartUploadRequestSchema.safeParse({ ...request, contentMd5 })
        .success,
    ).toBe(false);
  }
  expect(
    MultipartBlobPartUploadRequestSchema.safeParse({
      ...request,
      key: "another-object",
    }).success,
  ).toBe(false);
});

test("upload descriptors permit only HTTP storage URLs or explicit API capability", () => {
  const descriptor = {
    ...request,
    partNumber: 1,
    stageId: "11111111-1111-4111-8111-111111111111",
    source: { kind: "api" },
  };
  expect(
    MultipartBlobPartUploadResponseSchema.safeParse(descriptor).success,
  ).toBe(true);
  for (const url of [
    "https://storage.test/object?signature=example",
    "http://localhost:4566/object",
  ]) {
    expect(
      MultipartBlobPartUploadResponseSchema.safeParse({
        ...descriptor,
        source: {
          kind: "signed-url",
          url,
          expiresAt: "2026-10-13T12:05:00.000Z",
        },
      }).success,
    ).toBe(true);
  }
  expect(
    MultipartBlobPartUploadResponseSchema.safeParse({
      ...descriptor,
      source: {
        kind: "signed-url",
        url: "file:///secret",
        expiresAt: "2026-10-13T12:05:00.000Z",
      },
    }).success,
  ).toBe(false);
  expect(authorizeMultipartBlobPartUploadOperation).toMatchObject({
    method: "POST",
    auth: "session",
    path: "/blobs/stages/multipart/{stageId}/parts/{partNumber}/upload",
  });
});
