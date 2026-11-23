import { expect, test } from "bun:test";
import {
  createContainerWriterProjectionFixture,
  createMockApiClient,
} from "@tearleads/test-utils";
import type { DocumentWriterProjectionResponse } from "@tearleads/validators/response";
import {
  createFixtureBinding,
  createUploadedAttachmentFixture,
} from "../../../../test/helpers/workflows/blobHydrationFixture";
import {
  createExpiringApiServer,
  SCOPE_RETIREMENTS,
} from "../../../../test/helpers/workflows/expiringApiServer";
import { deriveDocumentTargetFromProjection } from "../../../data/documents/shared/projection";
import { isProjectionVerificationCancelledError } from "../../../data/keyingProjectionVerification";
import { ProjectionDependencyUnavailableError } from "../../../data/shared/dependencyUnavailable";
import { prepareDocumentLinkBlobRewraps } from "../../documents/linkSet/linkSetBlobRewraps";
import { createAttachmentProofReader } from "./attachmentDecryptor";

test.each(SCOPE_RETIREMENTS)(
  "a relink's ciphertext read that expires after %s is not renewed or replayed",
  async (change) => {
    const fixture = await createUploadedAttachmentFixture();
    const server = createExpiringApiServer({
      method: "GET",
      path: new RegExp(`^/blobs/${fixture.blobId}/bytes$`),
    });
    let current = true;
    try {
      const identity = await fixture.resolveProjectionUserKey(
        fixture.author.signerUserId,
      );
      if (!identity) throw new Error("Expected identity");
      const target = await createContainerWriterProjectionFixture({
        containerId: "relink-scope-destination",
        encapsulationPublicKey: identity.encapsulationPublicKey,
        organizationId: fixture.author.organizationId,
        signerKeyFingerprint: fixture.author.signerKeyFingerprint,
        signerPrivateKey: fixture.author.signerPrivateKey,
        userId: fixture.author.signerUserId,
      });
      const rewraps = prepareDocumentLinkBlobRewraps({
        apiClient: createMockApiClient({
          listDocumentAttachments: async () => [createFixtureBinding(fixture)],
          getBlobBytes: server.api.getBlobBytes,
          getDocumentWriterProjection: async () => fixture.writerProjection,
        }),
        execSql: fixture.execSql,
        resolveProjectionUserKey: fixture.resolveProjectionUserKey,
        stillCurrent: () => current,
        targetContainerProjection: target,
        targetSecretKey: fixture.secretKey,
        targets: [deriveDocumentTargetFromProjection(target)],
        writerProjection: fixture.writerProjection,
      }).then(
        () => null,
        (error: unknown) => error,
      );
      await server.entered;
      current = false;
      server.retire(change);
      server.release();
      expect(isProjectionVerificationCancelledError(await rewraps)).toBe(true);
      expect(server.requests).toEqual([`GET /blobs/${fixture.blobId}/bytes`]);
      expect(server.renewals.count).toBe(0);
    } finally {
      server.stop();
      fixture.close();
    }
  },
  15_000,
);

test.each(SCOPE_RETIREMENTS)(
  "an attachment proof refresh that expires after %s is not renewed or replayed",
  async (change) => {
    const documentId = crypto.randomUUID();
    const server = createExpiringApiServer({
      method: "GET",
      path: new RegExp(`^/documents/${documentId}/writer-projection$`),
    });
    let current = true;
    try {
      // Opaque stand-ins: the reader only forwards projections.
      const stale = { documentId } as DocumentWriterProjectionResponse;
      const read = createAttachmentProofReader(
        {
          evictDocumentWriterProjection: () => {},
          getDocumentWriterProjection: server.api.getDocumentWriterProjection,
        },
        documentId,
        async () => {
          throw new ProjectionDependencyUnavailableError(
            "Blob wrapped-target manifest is unavailable",
          );
        },
      );
      const refreshed = read({
        stillCurrent: () => current,
        writerProjection: stale,
      }).then(
        () => null,
        (error: unknown) => error,
      );
      await server.entered;
      current = false;
      server.retire(change);
      server.release();
      expect(isProjectionVerificationCancelledError(await refreshed)).toBe(
        true,
      );
      expect(server.requests).toEqual([
        `GET /documents/${documentId}/writer-projection`,
      ]);
      expect(server.renewals.count).toBe(0);
    } finally {
      server.stop();
    }
  },
  15_000,
);
