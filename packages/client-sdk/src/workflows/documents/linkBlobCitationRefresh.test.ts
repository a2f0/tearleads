import { expect, test } from "bun:test";
import {
  createContainerWriterProjectionFixture,
  createMockApiClient,
} from "@tearleads/test-utils";
import {
  createBlobBytesResponse,
  createFixtureBinding,
  createUploadedAttachmentFixture,
} from "../../../test/helpers/blobHydrationFixture";
import { refreshedCitation } from "../../../test/helpers/refreshedCitation";
import { deriveDocumentTargetFromProjection } from "../../data/documents/shared/projection";
import { readWriteHeader } from "../../data/documents/shared/readers";
import { prepareDocumentLinkBlobRewraps } from "./linkSetBlobRewraps";

for (const inScope of [false, true]) {
  for (const freshEvidence of [false, true]) {
    test(`attachment rewrap refreshes valid ancestor citations and rejects unrelated paths (fresh=${freshEvidence}, inScope=${inScope})`, async () => {
      const fixture = await createUploadedAttachmentFixture({
        nestedContainer: inScope,
      });
      try {
        const binding = createFixtureBinding(fixture);
        const citation = await refreshedCitation(
          fixture,
          fixture.execSql,
          readWriteHeader(binding.writeHeader, "fixture header"),
          inScope,
        );
        binding.writeHeader = { ...citation.header };
        const refreshed = citation.projection;
        const extra = inScope
          ? await createContainerWriterProjectionFixture({
              containerId: "new-link-destination",
              encapsulationPublicKey: fixture.publicKey,
              organizationId: fixture.author.organizationId,
              signerKeyFingerprint: fixture.author.signerKeyFingerprint,
              signerPrivateKey: fixture.author.signerPrivateKey,
              userId: fixture.author.signerUserId,
            })
          : citation.extra;
        const target = fixture.writerProjection.authorizingContainerPaths[0];
        if (!target) throw new Error("Expected target projection");
        let fetches = 0;
        let evictions = 0;
        let downloads = 0;
        const rewraps = prepareDocumentLinkBlobRewraps({
          apiClient: createMockApiClient({
            listDocumentAttachments: async () => [binding],
            getBlobBytes: async (blobId) => {
              downloads += 1;
              return createBlobBytesResponse({ blobId, ...fixture.stagedBlob });
            },
            evictDocumentWriterProjection: () => {
              evictions += 1;
            },
            getDocumentWriterProjection: async () => {
              fetches += 1;
              return freshEvidence ? refreshed : fixture.writerProjection;
            },
          }),
          execSql: fixture.execSql,
          resolveProjectionUserKey: fixture.resolveProjectionUserKey,
          targetContainerProjection: extra,
          targetSecretKey: fixture.secretKey,
          targets: [
            deriveDocumentTargetFromProjection(target),
            deriveDocumentTargetFromProjection(extra),
          ],
          writerProjection: fixture.writerProjection,
        });
        // The proposed destination cannot authorize an existing write.
        // A rotated ancestor of its original linked leaf can.
        if (inScope && freshEvidence) expect(await rewraps).toHaveLength(1);
        else
          await expect(rewraps).rejects.toMatchObject({
            code: freshEvidence ? "object_mismatch" : "missing_dependency",
          });
        expect(fetches).toBe(1);
        expect(evictions).toBe(1);
        expect(downloads).toBe(1);
      } finally {
        fixture.close();
      }
    });
  }
}
