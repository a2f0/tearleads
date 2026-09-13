import { expect, test } from "bun:test";
import { signWriteHeader, type WriteHeader } from "@tearleads/crypto";
import {
  createContainerWriterProjectionFixture,
  createMockApiClient,
  createTestExecSql,
} from "@tearleads/test-utils";
import {
  createMaterializedSyncFixture,
  createPendingUpdateRecord,
  createSyncResponse,
  writerKeyResolver,
} from "../../../test/helpers/documentFixtures";
import { syncRemoteDocumentWithoutImportValidationForTest as syncRemoteDocument } from "../../../test/helpers/documentSync";
import { buildMaterializedDocumentSyncPlan } from "./syncPlanMaterial";

for (const historyMode of ["normal", "raw"] as const) {
  for (const hasFreshEvidence of [false, true]) {
    test(`a submitted ${historyMode} response refetches citations missing from the cached projection (fresh=${hasFreshEvidence})`, async () => {
      const fixture = await createMaterializedSyncFixture();
      const { close, execSql } = await createTestExecSql(
        `submitted-citation-${historyMode}`,
      );
      try {
        const extra = await createContainerWriterProjectionFixture({
          containerId: "extra-authorizing-root",
          encapsulationPublicKey: fixture.publicKey,
          organizationId: fixture.author.organizationId,
          signerKeyFingerprint: fixture.author.signerKeyFingerprint,
          signerPrivateKey: fixture.author.signerPrivateKey,
          userId: fixture.author.signerUserId,
        });
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
        const { signature: _signature, ...unsigned } =
          update.writeHeader as unknown as WriteHeader;
        update.writeHeader = {
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
        if (hasFreshEvidence)
          expect((await result)?.decryptedUpdates).toHaveLength(1);
        else
          await expect(result).rejects.toMatchObject({
            code: "missing_dependency",
          });
        expect(refreshes).toBe(1);
        expect(submissions).toBe(1);
      } finally {
        close();
      }
    });
  }
}
