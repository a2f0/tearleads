import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  createBlobBytesResponse,
  createFixtureBinding,
  createUploadedAttachmentFixture,
} from "../../../test/helpers/blobHydrationFixture";
import { refreshedCitation } from "../../../test/helpers/refreshedCitation";
import { readWriteHeader } from "../../data/documents/shared/readers";
import { createAttachmentDecryptor } from "./attachmentDecryptor";
import { hydrateDocumentAttachmentBlobs } from "./hydrate";

for (const inScope of [false, true]) {
  for (const freshEvidence of [false, true]) {
    test(`attachment hydration refreshes valid ancestor citations and rejects unrelated paths (fresh=${freshEvidence}, inScope=${inScope})`, async () => {
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
        if (inScope && freshEvidence) {
          expect(await hydration).toHaveLength(1);
          expect(incidents).toEqual([]);
        } else {
          expect(await hydration).toEqual([]);
          expect(incidents).toHaveLength(1);
          expect(incidents[0]).toMatchObject({
            code: freshEvidence ? "object_mismatch" : "missing_dependency",
          });
        }
        expect(projections).toBe(2);
        expect(evictions).toBe(1);
        expect(downloads).toBe(1);
        if (freshEvidence) {
          const sharedDatabase = await createTestExecSql(
            "shared-citation-decrypt",
          );
          try {
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
              execSql: sharedDatabase.execSql,
              resolveProjectionUserKey: fixture.resolveProjectionUserKey,
              targetSecretKey: fixture.secretKey,
              writerProjection: fixture.writerProjection,
            };
            const shared = Promise.all([
              decrypt(decryptInput),
              decrypt(decryptInput),
            ]);
            if (inScope) expect(await shared).toHaveLength(2);
            else
              await expect(shared).rejects.toMatchObject({
                code: "object_mismatch",
              });
            expect(sharedFetches).toBe(1);
          } finally {
            sharedDatabase.close();
          }
        }
      } finally {
        fixture.close();
      }
    });
  }
}
