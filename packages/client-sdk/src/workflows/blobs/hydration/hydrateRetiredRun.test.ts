import { expect, test } from "bun:test";
import { createBlobAttachmentServiceFixture } from "../../../../test/helpers/workflows/blobAttachmentServiceFixture";
import {
  createFixtureBinding,
  createSingleAttachmentHydrationApi,
  createUploadedAttachmentFixture,
} from "../../../../test/helpers/workflows/blobHydration";
import { createBlobBytesResponse } from "../../../../test/helpers/workflows/blobHydrationFixture";
import {
  createExpiringApiServer,
  SCOPE_RETIREMENTS,
} from "../../../../test/helpers/workflows/expiringApiServer";

test.each(SCOPE_RETIREMENTS)(
  "a hydration run whose download expires after %s returns null, not an empty result",
  async (change) => {
    const fixture = await createUploadedAttachmentFixture();
    const server = createExpiringApiServer({
      method: "GET",
      path: new RegExp(`^/blobs/${fixture.blobId}/`),
    });
    const logs: string[] = [];
    let current = true;
    try {
      const hydrating = createBlobAttachmentServiceFixture({
        api: createSingleAttachmentHydrationApi(
          fixture,
          server.api.getBlobBytes,
        ),
        encapsulationSecretKey: fixture.secretKey,
        execSql: fixture.execSql,
        log: (message) => logs.push(message),
      }).hydrateDocumentAttachmentBlobs({
        attachments: [fixture.attachment],
        documentId: fixture.writerProjection.documentId,
        resolveProjectionUserKey: fixture.resolveProjectionUserKey,
        stillCurrent: () => current,
      });
      await server.entered;
      current = false;
      server.retire(change);
      server.release();
      expect(await hydrating).toBeNull();
      expect(logs).toEqual([]);
      expect(server.requests).toHaveLength(1);
      expect(server.renewals.count).toBe(0);
    } finally {
      server.stop();
      fixture.close();
    }
  },
  15_000,
);

// Every step a run can retire at reports the same outcome. Abort is separate:
// it rejects with the signal's reason.
const RETIREMENT_STEPS = [
  "after the binding listing",
  "during attachment verification",
  "after a verified binding",
] as const;

test.each(RETIREMENT_STEPS)(
  "a hydration run retired %s returns null",
  async (step) => {
    const fixture = await createUploadedAttachmentFixture();
    let current = true;
    const retireAt = (at: (typeof RETIREMENT_STEPS)[number]) => {
      if (step === at) current = false;
    };
    let checked = false;
    const service = createBlobAttachmentServiceFixture({
      api: {
        ...createSingleAttachmentHydrationApi(fixture, async () =>
          createBlobBytesResponse({
            blobId: fixture.blobId,
            ...fixture.stagedBlob,
          }),
        ),
        listDocumentAttachments: async () => {
          retireAt("after the binding listing");
          return [createFixtureBinding(fixture)];
        },
        supportsBoundedAttachmentReads: true,
      },
      encapsulationSecretKey: fixture.secretKey,
      execSql: fixture.execSql,
    }).withExpectedDownloads(
      fixture.writerProjection.documentId,
      new Map([[fixture.attachment.slotId, fixture.attachment.byteLength]]),
      new AbortController().signal,
      () => retireAt("after a verified binding"),
    );
    const hydrated = await service.hydrateDocumentAttachmentBlobs({
      attachments: [fixture.attachment],
      documentId: fixture.writerProjection.documentId,
      onBindingsChecked: () => {
        checked = true;
      },
      resolveProjectionUserKey: async (...args) => {
        const key = await fixture.resolveProjectionUserKey(...args);
        retireAt("during attachment verification");
        return key;
      },
      stillCurrent: () => current,
    });
    expect(current).toBe(false);
    expect(hydrated).toBeNull();
    expect(checked).toBe(false);
  },
  15_000,
);
