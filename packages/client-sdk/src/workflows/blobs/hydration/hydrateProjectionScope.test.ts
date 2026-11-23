import { expect, test } from "bun:test";
import { createBlobAttachmentServiceFixture } from "../../../../test/helpers/workflows/blobAttachmentServiceFixture";
import {
  createSingleAttachmentHydrationApi,
  createUploadedAttachmentFixture,
} from "../../../../test/helpers/workflows/blobHydration";
import { createBlobBytesResponse } from "../../../../test/helpers/workflows/blobHydrationFixture";
import {
  createExpiringApiServer,
  SCOPE_RETIREMENTS,
} from "../../../../test/helpers/workflows/expiringApiServer";

// An unbounded run reads through the API; a bounded one through the reader
// that adds its abort signal to every projection read.
const RUNS = ["unbounded", "bounded"] as const;

for (const run of RUNS) {
  test.each(SCOPE_RETIREMENTS)(
    `a ${run} hydration run's projection read that expires after %s is not renewed or replayed`,
    async (change) => {
      const fixture = await createUploadedAttachmentFixture();
      const { documentId } = fixture.writerProjection;
      const server = createExpiringApiServer({
        method: "GET",
        path: new RegExp(`^/documents/${documentId}/writer-projection$`),
      });
      const logs: string[] = [];
      let current = true;
      try {
        const service = createBlobAttachmentServiceFixture({
          api: {
            ...createSingleAttachmentHydrationApi(fixture, async () =>
              createBlobBytesResponse({
                blobId: fixture.blobId,
                ...fixture.stagedBlob,
              }),
            ),
            getDocumentWriterProjection: server.api.getDocumentWriterProjection,
            supportsBoundedAttachmentReads: run === "bounded",
          },
          encapsulationSecretKey: fixture.secretKey,
          execSql: fixture.execSql,
          log: (message) => logs.push(message),
        });
        const hydrating = (
          run === "bounded"
            ? service.withExpectedDownloads(
                documentId,
                new Map([
                  [fixture.attachment.slotId, fixture.attachment.byteLength],
                ]),
                new AbortController().signal,
              )
            : service
        ).hydrateDocumentAttachmentBlobs({
          attachments: [fixture.attachment],
          documentId,
          resolveProjectionUserKey: fixture.resolveProjectionUserKey,
          stillCurrent: () => current,
        });
        await server.entered;
        current = false;
        server.retire(change);
        server.release();
        expect(await hydrating).toBeNull();
        expect(logs).toEqual([]);
        expect(server.requests).toEqual([
          `GET /documents/${documentId}/writer-projection`,
        ]);
        expect(server.renewals.count).toBe(0);
      } finally {
        server.stop();
        fixture.close();
      }
    },
    15_000,
  );
}
