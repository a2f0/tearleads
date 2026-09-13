import { expect, test } from "bun:test";
import { signWriteHeader } from "@tearleads/crypto";
import {
  createContainerWriterProjectionFixture,
  createMockApiClient,
} from "@tearleads/test-utils";
import {
  createBlobBytesResponse,
  createFixtureBinding,
  createUploadedAttachmentFixture,
} from "../../../test/helpers/blobHydrationFixture";
import { deriveDocumentTargetFromProjection } from "../../data/documents/shared/projection";
import { readWriteHeader } from "../../data/documents/shared/readers";
import { prepareDocumentLinkBlobRewraps } from "./linkSetBlobRewraps";

for (const freshEvidence of [false, true]) {
  test(`attachment rewrap refreshes missing citations once (fresh=${freshEvidence})`, async () => {
    const fixture = await createUploadedAttachmentFixture();
    try {
      const extra = await createContainerWriterProjectionFixture({
        containerId: "additional-rewrap-citation",
        encapsulationPublicKey: fixture.publicKey,
        organizationId: fixture.author.organizationId,
        signerKeyFingerprint: fixture.author.signerKeyFingerprint,
        signerPrivateKey: fixture.author.signerPrivateKey,
        userId: fixture.author.signerUserId,
      });
      const binding = createFixtureBinding(fixture);
      const { signature: _signature, ...unsigned } = readWriteHeader(
        binding.writeHeader,
        "fixture header",
      );
      binding.writeHeader = {
        ...(await signWriteHeader(
          {
            ...unsigned,
            dependencyManifestHashes: [
              ...unsigned.dependencyManifestHashes,
              ...extra.path.map((head) => head.manifestHash),
            ].sort(),
          },
          fixture.author.signerPrivateKey,
        )),
      };
      const refreshed = {
        ...fixture.writerProjection,
        documentManifestContainerPaths: [
          ...fixture.writerProjection.documentManifestContainerPaths,
          extra.path,
        ],
      };
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
      if (freshEvidence) {
        const result = await rewraps;
        expect(result).toHaveLength(1);
        expect(result[0]?.targets).toHaveLength(2);
        expect(result[0]?.targets[0]?.wrappedKey).toBe(
          binding.contentKeyBundle.targets[0]?.wrappedKey,
        );
      } else
        await expect(rewraps).rejects.toMatchObject({
          code: "missing_dependency",
        });
      expect(fetches).toBe(1);
      expect(evictions).toBe(1);
      expect(downloads).toBe(1);
    } finally {
      fixture.close();
    }
  });
}
