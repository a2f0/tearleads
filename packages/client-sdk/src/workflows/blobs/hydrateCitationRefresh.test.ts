import { expect, test } from "bun:test";
import { signWriteHeader } from "@tearleads/crypto";
import { createContainerWriterProjectionFixture } from "@tearleads/test-utils";
import {
  createBlobBytesResponse,
  createFixtureBinding,
  createUploadedAttachmentFixture,
} from "../../../test/helpers/blobHydrationFixture";
import { readWriteHeader } from "../../data/documents/shared/readers";
import { createAttachmentDecryptor } from "./attachmentDecryptor";
import { hydrateDocumentAttachmentBlobs } from "./hydrate";

for (const freshEvidence of [false, true]) {
  test(`attachment hydration refreshes citations without accepting unrelated paths (fresh=${freshEvidence})`, async () => {
    const fixture = await createUploadedAttachmentFixture();
    try {
      const extra = await createContainerWriterProjectionFixture({
        containerId: "additional-blob-authorizing-root",
        encapsulationPublicKey: fixture.publicKey,
        organizationId: fixture.author.organizationId,
        signerKeyFingerprint: fixture.author.signerKeyFingerprint,
        signerPrivateKey: fixture.author.signerPrivateKey,
        userId: fixture.author.signerUserId,
      });
      const binding = createFixtureBinding(fixture);
      const { signature: _signature, ...unsigned } = readWriteHeader(
        binding.writeHeader,
        "Fixture write header",
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
      let projections = 0;
      let evictions = 0;
      let downloads = 0;
      const incidents: unknown[] = [];
      const hydration = hydrateDocumentAttachmentBlobs({
        apiClient: {
          evictDocumentWriterProjection: () => {
            evictions += 1;
          },
          getBlobBytes: async (blobId) => {
            downloads += 1;
            return createBlobBytesResponse({ blobId, ...fixture.stagedBlob });
          },
          getDocumentWriterProjection: async () => {
            projections += 1;
            return projections > 1 && freshEvidence
              ? refreshed
              : fixture.writerProjection;
          },
          listDocumentAttachments: async () => [binding],
        },
        reportSecurityIncident: async (error) => {
          incidents.push(error);
        },
        attachments: [fixture.attachment],
        documentId: fixture.writerProjection.documentId,
        execSql: fixture.execSql,
        resolveProjectionUserKey: fixture.resolveProjectionUserKey,
        targetSecretKey: fixture.secretKey,
      });
      expect(await hydration).toEqual([]);
      expect(incidents).toHaveLength(1);
      expect(incidents[0]).toMatchObject({
        code: freshEvidence ? "object_mismatch" : "missing_dependency",
      });
      expect(projections).toBe(2);
      expect(evictions).toBe(1);
      expect(downloads).toBe(1);
      if (freshEvidence) {
        let sharedFetches = 0;
        const decrypt = createAttachmentDecryptor(
          {
            getDocumentWriterProjection: async () => {
              sharedFetches += 1;
              return refreshed;
            },
          },
          fixture.writerProjection.documentId,
        );
        const decryptInput = {
          binding,
          encryptedBytes: fixture.stagedBlob.encryptedBytes,
          expectedDocumentId: fixture.writerProjection.documentId,
          expectedSlotId: fixture.attachment.slotId,
          execSql: fixture.execSql,
          resolveProjectionUserKey: fixture.resolveProjectionUserKey,
          targetSecretKey: fixture.secretKey,
          writerProjection: fixture.writerProjection,
        };
        await expect(
          Promise.all([decrypt(decryptInput), decrypt(decryptInput)]),
        ).rejects.toMatchObject({ code: "object_mismatch" });
        expect(sharedFetches).toBe(1);
      }
    } finally {
      fixture.close();
    }
  });
}
