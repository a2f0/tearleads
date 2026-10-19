import { expect, test } from "bun:test";
import type { DocumentSyncRequest } from "@tearleads/validators/request";
import { MAX_DOCUMENT_SYNC_REQUEST_BYTES } from "@tearleads/validators/util";
import { documentCreateSeedFits } from "./initialSync";

function seedWithData(encryptedData: string): DocumentSyncRequest {
  return {
    contentKeyEpoch: 1,
    expectedLinkSetManifestHash: "document-link-set-hash",
    expectedTargetHash: "target-hash",
    localVersionVector: '{"actor":1}',
    outgoingUpdates: [
      {
        encryptedData,
        id: "550e8400-e29b-41d4-a716-446655440111",
        partialEndVersionVector: '{"actor":1}',
        partialStartVersionVector: "{}",
        plaintextHash: "plaintext-hash",
        writeHeader: {},
      },
    ],
    supportsPullPagination: true,
  };
}

test("a create seed must fit the document sync request limit", () => {
  expect(documentCreateSeedFits(seedWithData("small"))).toBe(true);
  expect(
    documentCreateSeedFits(
      seedWithData("a".repeat(MAX_DOCUMENT_SYNC_REQUEST_BYTES - 64)),
    ),
  ).toBe(false);
});
