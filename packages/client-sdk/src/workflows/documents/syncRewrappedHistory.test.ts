import { expect, test } from "bun:test";
import { base64ToBytes } from "@tearleads/encoding";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  createMaterializedSyncFixture,
  createPendingUpdateRecord,
  createSyncResponse,
  writerKeyResolver,
} from "../../../test/helpers/documentFixtures";
import { wrapDocumentContentKeyForCreate } from "../../data/documents/shared/projection";
import { buildMaterializedDocumentSyncPlan } from "./syncPlanMaterial";
import { syncRemoteDocumentResultFromResponse } from "./syncResponseResult";

for (const historyMode of [undefined, "raw"] as const) {
  for (const wrongKey of [false, true]) {
    test(`historical rewrap requires the correct content key (${historyMode ?? "ordinary"} pull, wrong key: ${wrongKey})`, async () => {
      const { close, execSql } = await createTestExecSql("rewrapped-history");
      try {
        const fixture = await createMaterializedSyncFixture();
        const pendingUpdate = createPendingUpdateRecord();
        const historicalPlan = await buildMaterializedDocumentSyncPlan({
          author: fixture.author,
          execSql,
          localVersionVector: null,
          pendingUpdates: [pendingUpdate],
          resolveProjectionUserKey: fixture.resolveProjectionUserKey,
          targetSecretKey: fixture.secretKey,
          writerProjection: fixture.writerProjection,
        });
        const historicalResponse = await createSyncResponse(
          historicalPlan.plan,
        );
        const currentBundle = {
          ...fixture.writerProjection.contentKeyBundle,
          contentKeyEpoch: 2,
        };
        const writerProjection = {
          ...fixture.writerProjection,
          contentKeyBundle: currentBundle,
        };
        const materializedPlan = await buildMaterializedDocumentSyncPlan({
          author: fixture.author,
          execSql,
          historyMode,
          localVersionVector: null,
          pendingUpdates: [],
          resolveProjectionUserKey: fixture.resolveProjectionUserKey,
          targetSecretKey: fixture.secretKey,
          writerProjection,
        });
        const response = await createSyncResponse(materializedPlan.plan, {
          contentKeyBundles: [
            {
              ...historicalResponse.contentKeyBundle,
              linkSetManifestHash: "refreshed-link-set-metadata",
              targets: wrongKey
                ? await wrapDocumentContentKeyForCreate({
                    contentKey: new Uint8Array(32).fill(7),
                    execSql,
                    projection: fixture.projection,
                    resolveProjectionUserKey: fixture.resolveProjectionUserKey,
                    secretKey: fixture.secretKey,
                  })
                : historicalResponse.contentKeyBundle.targets,
            },
            currentBundle,
          ],
          updates: historicalResponse.updates,
        });
        let authenticated = false;
        const result = syncRemoteDocumentResultFromResponse({
          execSql,
          materializedPlan,
          recoveryPendingUpdatesById: new Map(),
          resolveProjectionUserKey: fixture.resolveProjectionUserKey,
          resolveWriterPublicKey: writerKeyResolver(fixture),
          response,
          targetSecretKey: fixture.secretKey,
          validateIncomingUpdates: ({ decryptedUpdates }) => {
            expect(decryptedUpdates).toHaveLength(1);
            expect(decryptedUpdates[0]?.updateData).toEqual(
              base64ToBytes(pendingUpdate.updateData),
            );
            authenticated = true;
          },
          writerProjection,
        });
        if (wrongKey) {
          await expect(result).rejects.toMatchObject({ stage: "decrypt" });
          expect(authenticated).toBe(false);
        } else {
          await result;
          expect(authenticated).toBe(true);
        }
      } finally {
        close();
      }
    });
  }
}
