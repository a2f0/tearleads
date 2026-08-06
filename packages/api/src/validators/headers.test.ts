import { expect, test } from "bun:test";
import {
  blobWireHeaderKeys,
  blobWireHeaderNames,
  MultipartBlobPartHeadersSchema,
} from "@tearleads/validators/operation";
import { Hono } from "hono";
import { headersValidator } from "./headers";

test("header validation normalizes names across HTTP runtimes", async () => {
  const app = new Hono();
  app.put("/", headersValidator(MultipartBlobPartHeadersSchema), (c) =>
    c.json(c.req.valid("header")),
  );

  const response = await app.request("/", {
    headers: {
      [blobWireHeaderNames.partByteLength]: "5",
      [blobWireHeaderNames.partSha256]: "a".repeat(64),
      [blobWireHeaderNames.partUploadId]: "upload-1",
    },
    method: "PUT",
  });

  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    [blobWireHeaderKeys.partByteLength]: "5",
    [blobWireHeaderKeys.partSha256]: "a".repeat(64),
    [blobWireHeaderKeys.partUploadId]: "upload-1",
  });
});
