import { expect, test } from "bun:test";
import type { WriteHeader } from "@tearleads/crypto";
import { createMockApiClient, createTestExecSql } from "@tearleads/test-utils";
import {
  createMaterializedSyncFixture,
  createPendingUpdateRecord,
  createSyncResponse,
  writerKeyResolver,
} from "../../../test/helpers/documentFixtures";
import { syncRemoteDocumentWithoutImportValidationForTest as syncRemoteDocument } from "../../../test/helpers/documentSync";
import { refreshedCitation } from "../../../test/helpers/refreshedCitation";
import { buildMaterializedDocumentSyncPlan } from "./syncPlanMaterial";

for (const inScope of [false, true]) {
  for (const historyMode of ["normal", "raw"] as const) {
    for (const hasFreshEvidence of [false, true]) {
      test(`a submitted ${historyMode} response refreshes valid citations and refuses unrelated paths (fresh=${hasFreshEvidence}, inScope=${inScope})`, async () => {
        const fixture = await createMaterializedSyncFixture({
          nestedContainer: inScope,
        });
        const { close, execSql } = await createTestExecSql(
          `submitted-citation-${historyMode}`,
        );
        try {
          const updatePlan = await buildMaterializedDocumentSyncPlan({
            author: fixture.author,
            localVersionVector: null,
            pendingUpdates: [createPendingUpdateRecord()],
            targetSecretKey: fixture.secretKey,
            trustedLocalProjection: true,
            writerProjection: fixture.writerProjection,
          });
          const response = await createSyncResponse(updatePlan.plan, {
            acceptedOutgoingUpdateIds: [],
          });
          const update = response.updates[0];
          if (!update) throw new Error("Expected remote update");
          const citation = await refreshedCitation(
            fixture,
            execSql,
            update.writeHeader as unknown as WriteHeader,
            inScope,
          );
          update.writeHeader = { ...citation.header };
          const refreshed = citation.projection;
          let refreshes = 0;
          let submissions = 0;
          const result = syncRemoteDocument({
            apiClient: createMockApiClient({
              evictDocumentWriterProjection: () => undefined,
              getDocumentWriterProjection: async () => {
                refreshes += 1;
                return hasFreshEvidence ? refreshed : fixture.writerProjection;
              },
              syncDocument: async () => {
                submissions += 1;
                return response;
              },
            }),
            author: fixture.author,
            documentId: fixture.writerProjection.documentId,
            execSql,
            historyMode: historyMode === "raw" ? "raw" : undefined,
            localVersionVector: null,
            resolveProjectionUserKey: fixture.resolveProjectionUserKey,
            resolveWriterPublicKey: writerKeyResolver(fixture),
            targetSecretKey: fixture.secretKey,
            writerProjection: fixture.writerProjection,
          });
          // This is signed evidence for an unlinked container. Fetching it fixes
          // availability, but cannot turn it into document write authority.
          if (inScope && hasFreshEvidence) expect(await result).not.toBeNull();
          else
            await expect(result).rejects.toMatchObject({
              code: hasFreshEvidence ? "object_mismatch" : "missing_dependency",
            });
          expect(refreshes).toBe(1);
          expect(submissions).toBe(1);
        } finally {
          close();
        }
      });
    }
  }
}
