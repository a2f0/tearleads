import { expect, test } from "bun:test";
import {
  documentCreate,
  documentDelete,
  documentLink,
  documentUnlink,
} from "./mutations";

test("document mutation client metadata derives from shared operations", () => {
  expect(documentCreate).toMatchObject({
    method: "POST",
    path: "/documents",
  });
  expect(documentCreate.isRequest).toBeDefined();
  expect(documentCreate.isResponse).toBeDefined();

  for (const [metadata, suffix] of [
    [documentLink, "link"],
    [documentUnlink, "unlink"],
  ] as const) {
    expect(metadata.method).toBe("POST");
    expect(metadata.path("document/1")).toBe(
      `/documents/document%2F1/${suffix}`,
    );
    expect(metadata.isRequest).toBeDefined();
    expect(metadata.isResponse).toBeDefined();
  }

  expect(documentDelete.method).toBe("DELETE");
  expect(documentDelete.path("document/1")).toBe("/documents/document%2F1");
  expect(documentDelete.isResponse).toBeDefined();
});
