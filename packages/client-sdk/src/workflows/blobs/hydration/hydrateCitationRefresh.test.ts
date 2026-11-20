import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { createBlobAttachmentServiceFixture } from "../../../../test/helpers/workflows/blobAttachmentServiceFixture";
import {
  createBlobBytesResponse,
  createFixtureBinding,
  createUploadedAttachmentFixture,
} from "../../../../test/helpers/workflows/blobHydrationFixture";
import { refreshedCitation } from "../../../../test/helpers/workflows/refreshedCitation";
import { readWriteHeader } from "../../../data/documents/shared/readers";
import { createAttachmentDecryptor } from "../verification/attachmentDecryptor";

for (const inScope of [false, true]) {
  for (const mode of [
    "stale",
    "fresh",
    ...(inScope ? ["bounded", "bounded without signal"] : []),
  ]) {
    const freshEvidence = mode !== "stale";
    const signal =
      mode === "bounded" ? new AbortController().signal : undefined;
    test(`attachment hydration refreshes valid ancestor citations and rejects unrelated paths (mode=${mode}, inScope=${inScope})`, async () => {
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
        const service = createBlobAttachmentServiceFixture({
          api: {
            evictDocumentWriterProjection: () => {
              evictions += 1;
            },
            getBlobBytes: async (blobId) => {
              downloads += 1;
              return createBlobBytesResponse({ blobId, ...fixture.stagedBlob });
            },
            getDocumentWriterProjection: async (
              _id: string,
              options?: { signal: AbortSignal },
            ) => {
              if (mode === "bounded without signal")
                expect(options?.signal).toBeInstanceOf(AbortSignal);
              else expect(options?.signal).toBe(signal);
              projections += 1;
              return projections > 1 && freshEvidence
                ? refreshed
                : fixture.writerProjection;
            },
            listDocumentAttachments: async () => [binding],
          },
          encapsulationSecretKey: fixture.secretKey,
          execSql: fixture.execSql,
          reportSecurityIncident: async (error) => {
            incidents.push(error);
          },
        });
        const reader = mode.startsWith("bounded")
          ? service.withExpectedDownloads(
              fixture.writerProjection.documentId,
              new Map([
                [fixture.attachment.slotId, fixture.attachment.byteLength],
              ]),
              signal,
            )
          : service;
        const hydration = reader.hydrateDocumentAttachmentBlobs({
          attachments: [fixture.attachment],
          documentId: fixture.writerProjection.documentId,
          resolveProjectionUserKey: fixture.resolveProjectionUserKey,
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
        expect(evictions).toBe(mode.startsWith("bounded") ? 0 : 1);
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
