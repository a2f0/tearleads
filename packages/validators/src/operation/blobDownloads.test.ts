import { expect, test } from "bun:test";
import { BlobDownloadResponseSchema } from "./blobDownloads";
import type { operations } from "./generatedOpenApi";
import { openApiDocument } from "./openApi";

const response = {
  blobId: "11111111-1111-4111-8111-111111111111",
  byteLength: 5,
  sha256: "a".repeat(64),
  source: {
    kind: "signed-url" as const,
    url: "https://storage.test/object?X-Amz-Signature=secret",
    expiresAt: "2026-10-13T12:05:00.000Z",
  },
};

test("download descriptor has generated types and a session-protected OpenAPI operation", () => {
  const generated: operations["blobs.download.get"]["responses"][200]["content"]["application/json"] =
    BlobDownloadResponseSchema.parse(response);
  expect(generated).toEqual(response);
  expect(
    JSON.stringify(openApiDocument.paths["/blobs/{blobId}/download"]),
  ).not.toContain('"$schema"');
  expect(
    openApiDocument.paths["/blobs/{blobId}/download"]?.get?.security,
  ).toEqual([{ bearerAuth: [] }]);
});

test("download descriptors reject unsafe URLs and invalid integrity metadata", () => {
  for (const invalid of [
    { ...response, source: { ...response.source, url: "file:///etc/passwd" } },
    { ...response, source: { ...response.source, expiresAt: "not-a-date" } },
    { ...response, byteLength: Number.MAX_SAFE_INTEGER + 1 },
    { ...response, sha256: "invalid" },
  ])
    expect(BlobDownloadResponseSchema.safeParse(invalid).success).toBe(false);
  expect(
    BlobDownloadResponseSchema.safeParse({
      ...response,
      source: { kind: "api" },
    }).success,
  ).toBe(true);
});
