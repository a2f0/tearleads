import { expect, test } from "bun:test";
import { createMockApiClient } from "@tearleads/test-utils";
import {
  createBlobBytesResponse,
  createFixtureBinding,
} from "../../../test/helpers/blobHydrationFixture";
import { createPagedAttachmentFixture } from "../../../test/helpers/blobProjectionHistory";
import { deriveDocumentTargetFromProjection } from "../../data/documents/shared/projection";
import { prepareDocumentLinkBlobRewraps } from "../documents/linkSetBlobRewraps";
import { detachDocumentAttachment } from "./detach";
import { hydrateDocumentAttachmentBlobs } from "./hydrate";
import { verifyRetainedAttachment } from "./retainedAttachmentVerification";

for (const operation of ["detach", "hydrate", "retain", "relink"] as const) {
  test(`${operation} recovers compact projection policy history`, async () => {
    const fixture = await createPagedAttachmentFixture();
    const binding = createFixtureBinding(fixture);
    const documentId = fixture.writerProjection.documentId;
    let detached = 0;
    const apiClient = createMockApiClient({
      getDocumentWriterProjection: async () => fixture.writerProjection,
      listDocumentAttachments: async () => [binding],
      getBlobBytes: async (blobId) =>
        createBlobBytesResponse({
          blobId,
          encryptedBytes: fixture.stagedBlob.encryptedBytes,
          sha256: fixture.stagedBlob.sha256,
        }),
      detachBlobAttachment: async () => {
        detached += 1;
        return {
          bindingId: fixture.bindingId,
          blobId: fixture.blobId,
          documentId,
          slotId: fixture.attachment.slotId,
        };
      },
    });
    const verification = {
      execSql: fixture.execSql,
      resolveProjectionUserKey: fixture.resolveProjectionUserKey,
      targetSecretKey: fixture.secretKey,
      warmReferencedPrincipalPolicies: fixture.warmReferencedPrincipalPolicies,
    };
    try {
      if (operation === "detach") {
        expect(
          await detachDocumentAttachment({
            ...verification,
            apiClient,
            author: fixture.author,
            bindingId: fixture.bindingId,
            blobId: fixture.blobId,
            documentId,
            slotId: fixture.attachment.slotId,
          }),
        ).not.toBeNull();
        expect(detached).toBe(1);
      } else if (operation === "hydrate") {
        const hydrated = await hydrateDocumentAttachmentBlobs({
          ...verification,
          apiClient,
          attachments: [fixture.attachment],
          documentId,
        });
        expect(hydrated).toHaveLength(1);
        expect(hydrated?.[0]?.bytes).toEqual(fixture.bytes);
      } else if (operation === "retain") {
        await verifyRetainedAttachment({
          ...verification,
          binding,
          expectedDocumentId: documentId,
          expectedSlotId: fixture.attachment.slotId,
          writerProjection: fixture.writerProjection,
        });
      } else {
        const projection =
          fixture.writerProjection.authorizingContainerPaths[0];
        if (!projection) throw new Error("Missing fixture path");
        const rewraps = await prepareDocumentLinkBlobRewraps({
          ...verification,
          apiClient,
          writerProjection: fixture.writerProjection,
          targetContainerProjection: {
            ...projection,
            policyEvidence: fixture.writerProjection.policyEvidence,
          },
          targets: [deriveDocumentTargetFromProjection(projection)],
        });
        expect(rewraps).toHaveLength(1);
        expect(rewraps[0]?.targets[0]?.wrappedKey).toBe(
          binding.contentKeyBundle.targets[0]?.wrappedKey,
        );
      }
    } finally {
      fixture.close();
    }
  });
}

test("attachment detach cannot submit after its policy recovery lifetime changes", async () => {
  const fixture = await createPagedAttachmentFixture();
  const recover =
    fixture.warmReferencedPrincipalPolicies.resolveProjectionHistory;
  if (!recover) throw new Error("Expected paged recovery");
  let current = true;
  let submissions = 0;
  try {
    await expect(
      detachDocumentAttachment({
        apiClient: createMockApiClient({
          getDocumentWriterProjection: async () => fixture.writerProjection,
          detachBlobAttachment: async () => {
            submissions += 1;
            return null;
          },
        }),
        author: fixture.author,
        bindingId: fixture.bindingId,
        blobId: fixture.blobId,
        documentId: fixture.writerProjection.documentId,
        execSql: fixture.execSql,
        resolveProjectionUserKey: fixture.resolveProjectionUserKey,
        slotId: fixture.attachment.slotId,
        stillCurrent: () => current,
        warmReferencedPrincipalPolicies: Object.assign(async () => {}, {
          async resolveProjectionHistory(input: Parameters<typeof recover>[0]) {
            const result = await recover(input);
            current = false;
            return result;
          },
        }),
      }),
    ).rejects.toMatchObject({ name: "ProjectionVerificationCancelledError" });
    expect(submissions).toBe(0);
  } finally {
    fixture.close();
  }
});
