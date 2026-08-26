import { expect, test } from "bun:test";
import {
  documentCreate,
  documentLink,
  documentPurge,
  documentPurgeProof,
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

  expect(documentPurge.method).toBe("POST");
  expect(documentPurge.path("document/1")).toBe(
    "/documents/document%2F1/purge",
  );
  expect(documentPurge.isRequest).toBeDefined();
  expect(documentPurge.isResponse).toBeDefined();
  expect(documentPurgeProof.method).toBe("GET");
  expect(documentPurgeProof.path("document/1")).toBe(
    "/documents/document%2F1/purge",
  );
  expect(
    documentPurgeProof.path("document/1", {
      checkpointManifestHashes: ["head-1", "head-2"],
    }),
  ).toBe(
    "/documents/document%2F1/purge?checkpointManifestHashes=head-1%2Chead-2",
  );
  expect(documentPurgeProof.isResponse).toBeDefined();
});
