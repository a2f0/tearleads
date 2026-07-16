import { expect, test } from "bun:test";
import { resolveMultipartUploadOptions } from "./automaticMultipartUpload";

test("automatic multipart uses exact 5 MiB chunks for every upload", () => {
  expect(resolveMultipartUploadOptions(undefined)).toEqual({
    partSize: 5 * 1024 * 1024,
  });
});

test("automatic multipart preserves explicit resume options", () => {
  const explicit = {
    partSize: 5 * 1024 * 1024,
    resumeStageId: "stage-resume",
    uploadConcurrency: 2,
  };
  expect(resolveMultipartUploadOptions(explicit)).toBe(explicit);
});

test("automatic multipart rejects every non-5-MiB chunk size", () => {
  for (const partSize of [5 * 1024 * 1024 - 1, 5 * 1024 * 1024 + 1]) {
    expect(() => resolveMultipartUploadOptions({ partSize })).toThrow(
      "Multipart blob chunk size must be exactly 5 MiB",
    );
  }
});
