import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { DOCUMENT_NOT_FOUND_ERROR_CODE } from "@tearleads/validators/response";
import {
  createExpiringApiServer,
  SCOPE_RETIREMENTS,
} from "../../../../test/helpers/workflows/expiringApiServer";
import { createMaterializedSyncFixture } from "../../../../test/helpers/workflows/materializedSyncFixture";
import { createRemoteDocumentServiceFixture } from "../../../../test/helpers/workflows/remoteDocumentServiceFixture";
import { isProjectionVerificationCancelledError } from "../../../data/keyingProjectionVerification";

const HELD_REQUESTS = {
  "writer-projection read": { method: "GET", path: "writer-projection" },
  POST: { method: "POST", path: "purge" },
  "proof read": { method: "GET", path: "purge" },
} as const;

for (const [held, request] of Object.entries(HELD_REQUESTS)) {
  test.each(SCOPE_RETIREMENTS)(
    `a purge ${held} that expires after %s is not renewed or replayed`,
    async (change) => {
      const { author, resolveProjectionUserKey, writerProjection } =
        await createMaterializedSyncFixture();
      const { documentId } = writerProjection;
      const { close, execSql } = await createTestExecSql(
        `document-purge-scope-${held}-${change}`,
      );
      const server = createExpiringApiServer({
        method: request.method,
        path: new RegExp(`^/documents/${documentId}/${request.path}$`),
      });
      let current = true;
      let verifiedPurges = 0;
      try {
        const purged = createRemoteDocumentServiceFixture({
          api: {
            getDocumentPurgeProof:
              held === "proof read"
                ? server.api.getDocumentPurgeProof
                : async () => {
                    throw new Error("Only a purged document reads its proof");
                  },
            getDocumentWriterProjectionResult:
              held === "writer-projection read"
                ? server.api.getDocumentWriterProjectionResult
                : async () =>
                    held === "POST"
                      ? { data: writerProjection, ok: true }
                      : {
                          code: DOCUMENT_NOT_FOUND_ERROR_CODE,
                          message: "Document not found",
                          ok: false,
                          report: () => undefined,
                          status: 404,
                        },
            purgeDocument:
              held === "POST"
                ? server.api.purgeDocument
                : async () => {
                    throw new Error("A retired purge must not submit");
                  },
          },
          execSql,
        })
          .purgeRemoteDocument({
            author,
            documentId,
            onVerifiedPurge: async () => {
              verifiedPurges += 1;
            },
            resolveProjectionUserKey,
            stillCurrent: () => current,
          })
          .then(
            () => null,
            (error: unknown) => error,
          );
        await server.entered;
        current = false;
        server.retire(change);
        server.release();
        // Each retired step cancels the pass rather than failing the purge.
        expect(isProjectionVerificationCancelledError(await purged)).toBe(true);
        expect(server.requests).toEqual([
          `${request.method} /documents/${documentId}/${request.path}`,
        ]);
        expect(server.renewals.count).toBe(0);
        expect(verifiedPurges).toBe(0);
      } finally {
        server.stop();
        close();
      }
    },
    15_000,
  );
}
