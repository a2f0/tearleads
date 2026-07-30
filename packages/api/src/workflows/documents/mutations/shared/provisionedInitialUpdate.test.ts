import { expect, test } from "bun:test";
import {
  createDocument,
  emptyVersionVector,
  encodeVersionVector,
} from "@tearleads/loro";
import type { DocumentSyncRequest } from "@tearleads/validators/request";
import { assertProvisionedDocumentInitialUpdate } from "./provisionedInitialUpdate";

function seedRequest(input: {
  endVersionVector: string;
  localVersionVector: string | null;
  startVersionVector: string;
}): DocumentSyncRequest {
  return {
    authorizingContainerPathRefs: [
      [{ containerId: "container-1", manifestHash: "manifest-1" }],
    ],
    contentKeyEpoch: 1,
    expectedLinkSetManifestHash: "link-set-1",
    expectedTargetHash: "target-1",
    localVersionVector: input.localVersionVector,
    outgoingUpdates: [
      {
        id: "550e8400-e29b-41d4-a716-446655440001",
        encryptedData: "ciphertext",
        partialStartVersionVector: input.startVersionVector,
        partialEndVersionVector: input.endVersionVector,
        plaintextHash: "provisioned-initial-plaintext-hash",
        writeHeader: {},
      },
    ],
  };
}

test("provisioned initial updates require a genesis span and matching local frontier", async () => {
  const empty = emptyVersionVector();
  const document = await createDocument("provisioned-initial-update-test");
  const genesis = encodeVersionVector(document);
  document.getText("name").update("Personal Org");
  const end = encodeVersionVector(document);

  expect(() =>
    assertProvisionedDocumentInitialUpdate(
      seedRequest({
        endVersionVector: end,
        localVersionVector: end,
        startVersionVector: genesis,
      }),
    ),
  ).not.toThrow();
  expect(() =>
    assertProvisionedDocumentInitialUpdate(
      seedRequest({
        endVersionVector: end,
        localVersionVector: end,
        startVersionVector: end,
      }),
    ),
  ).toThrow(
    "Provisioned document initial update must start from an empty version vector",
  );
  expect(() =>
    assertProvisionedDocumentInitialUpdate(
      seedRequest({
        endVersionVector: end,
        localVersionVector: empty,
        startVersionVector: genesis,
      }),
    ),
  ).toThrow(
    "Provisioned document local version vector must match the initial update end",
  );
});
