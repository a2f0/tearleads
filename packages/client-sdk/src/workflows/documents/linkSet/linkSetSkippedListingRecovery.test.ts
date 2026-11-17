import { expect, test } from "bun:test";
import {
  type DocumentLinkAccessEventBody,
  normalizeDocumentAccessEventBody,
  readKeyingCanonicalJson,
} from "@tearleads/crypto";
import {
  createContainerWriterProjectionFixture,
  createMockApiClient,
  createTestExecSql,
} from "@tearleads/test-utils";
import {
  DOCUMENT_MUTATION_ERROR_CODES,
  type DocumentWriterProjectionResponse,
} from "@tearleads/validators/response";
import { createLinkSetResponseFromRequest } from "../../../../test/helpers/data/documentFixtures";
import {
  createBlobBytesResponse,
  createFixtureBinding,
  createUploadedAttachmentFixture,
} from "../../../../test/helpers/workflows/blobHydration";
import {
  bindingWithTargets,
  linkSetRefusal,
  seedLocalView,
} from "../../../../test/helpers/workflows/linkSetLegFixture";
import { createRemoteDocumentServiceFixture } from "../../../../test/helpers/workflows/remoteDocumentServiceFixture";
import { readCanonicalRecord } from "../../../data/keying/canonicalJson";
import { decryptDocumentAttachmentBlob } from "../../blobs/hydration/decrypt";

const ATTACHMENTS_CHANGED = {
  code: DOCUMENT_MUTATION_ERROR_CODES.linkAttachmentsChanged,
  message:
    "Document attachments changed; retry the link with current blob keys",
  status: 409,
};

test("a stale empty view recovers with an envelope the destination can open", async () => {
  const fixture = await createUploadedAttachmentFixture();
  const identity = await fixture.resolveProjectionUserKey(
    fixture.author.signerUserId,
  );
  if (!identity) throw new Error("Expected fixture identity");
  const destination = await createContainerWriterProjectionFixture({
    containerId: "stale-view-destination",
    encapsulationPublicKey: identity.encapsulationPublicKey,
    organizationId: fixture.author.organizationId,
    signerKeyFingerprint: fixture.author.signerKeyFingerprint,
    signerPrivateKey: fixture.author.signerPrivateKey,
    userId: fixture.author.signerUserId,
  });
  const documentId = fixture.writerProjection.documentId;
  // This device holds the document but never hydrated its attachment.
  await seedLocalView(fixture.execSql, documentId, "empty");
  const binding = createFixtureBinding(fixture);
  const signedRewraps: DocumentLinkAccessEventBody["blobRewraps"][] = [];
  const primed: DocumentWriterProjectionResponse[] = [];
  let listings = 0;
  const linked = await createRemoteDocumentServiceFixture({
    api: createMockApiClient({
      getBlobBytes: async (blobId) =>
        createBlobBytesResponse({
          blobId,
          encryptedBytes: fixture.stagedBlob.encryptedBytes,
          sha256: fixture.stagedBlob.sha256,
        }),
      getContainerWriterProjection: async () => destination,
      getDocumentWriterProjection: async () => fixture.writerProjection,
      listDocumentAttachments: async () => {
        listings += 1;
        return [binding];
      },
      // The server's binding check: the active binding must be cited.
      linkDocumentResult: async (requestDocumentId, request) => {
        const { blobRewraps } = normalizeDocumentAccessEventBody(
          readKeyingCanonicalJson(request.body, "link body"),
        );
        signedRewraps.push(blobRewraps);
        return blobRewraps.some((rewrap) => rewrap.blobId === binding.blobId)
          ? {
              data: await createLinkSetResponseFromRequest(
                requestDocumentId,
                request,
              ),
              ok: true as const,
            }
          : linkSetRefusal(requestDocumentId, ATTACHMENTS_CHANGED);
      },
      primeDocumentWriterProjection: (_id, projection) => {
        primed.push(projection);
      },
    }),
    encapsulationSecretKey: fixture.secretKey,
    execSql: fixture.execSql,
  }).relinkRemoteDocument({
    author: fixture.author,
    documentId,
    operation: "link",
    resolveProjectionUserKey: fixture.resolveProjectionUserKey,
    targetContainerId: destination.containerId,
  });
  if (!linked || !primed[0]) throw new Error("Expected the retried link");
  expect(listings).toBe(1);
  expect(signedRewraps.map((rewraps) => rewraps.length)).toEqual([0, 1]);
  const destinationTargets = (signedRewraps[1]?.[0]?.targets ?? []).filter(
    (target) => target.containerId === destination.containerId,
  );
  expect(destinationTargets).toHaveLength(1);
  const writerProjection = {
    ...primed[0],
    authorizingContainerPaths: [destination],
  };
  const destinationBinding = await bindingWithTargets(
    binding,
    writerProjection,
    destinationTargets.map((envelope) => ({
      ...envelope,
      wrappingMetadata: readCanonicalRecord(
        envelope.wrappingMetadata,
        "rewrap metadata",
      ),
    })),
  );
  const cold = await createTestExecSql("stale-view-destination-read");
  try {
    const bytes = await decryptDocumentAttachmentBlob({
      binding: destinationBinding,
      encryptedBytes: fixture.stagedBlob.encryptedBytes,
      expectedDocumentId: documentId,
      expectedSlotId: fixture.attachment.slotId,
      execSql: cold.execSql,
      resolveProjectionUserKey: fixture.resolveProjectionUserKey,
      targetSecretKey: fixture.secretKey,
      writerProjection,
    });
    expect(Array.from(bytes)).toEqual(Array.from(fixture.bytes));
  } finally {
    cold.close();
  }
});
