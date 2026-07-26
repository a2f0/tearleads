import { bytesToBase64 } from "@tearleads/encoding";
import {
  createDocument,
  exportAllUpdates,
  exportFullHistorySnapshot,
  getUpdateVersionVectors,
} from "@tearleads/loro";
import { buildMaterializedDocumentSyncPlan } from "../../src/workflows/documents/sync";
import {
  createMaterializedSyncFixture,
  createPendingUpdateRecord,
  createSyncResponse,
} from "./documentFixtures";

/**
 * A remote document whose op log spans two commits ("survives key" then
 * "survives key rotation"), materialized into a sync response a store-level
 * recovery pull can replay. Shared by the rotation-preflight and stale-heal
 * recovery suites, which both rebuild full history from this fixture.
 */
export async function createRemoteHistoryFixture(): Promise<
  Awaited<ReturnType<typeof createMaterializedSyncFixture>> & {
    behindSnapshot: Uint8Array;
    remoteDocument: Awaited<ReturnType<typeof createDocument>>;
    response: Awaited<ReturnType<typeof createSyncResponse>>;
  }
> {
  const materialized = await createMaterializedSyncFixture();
  const remoteDocument = await createDocument("rotation-recovery-remote");
  remoteDocument.getText("text").update("survives key");
  remoteDocument.commit();
  const behindSnapshot = exportFullHistorySnapshot(remoteDocument);
  remoteDocument.getText("text").update("survives key rotation");
  remoteDocument.commit();
  const update = exportAllUpdates(remoteDocument);
  const vectors = getUpdateVersionVectors(update);
  const remotePlan = await buildMaterializedDocumentSyncPlan({
    author: materialized.author,
    localVersionVector: null,
    pendingUpdates: [
      createPendingUpdateRecord({
        updateData: bytesToBase64(update),
        ...vectors,
      }),
    ],
    targetSecretKey: materialized.secretKey,
    trustedLocalProjection: true,
    writerProjection: materialized.writerProjection,
  });
  const response = await createSyncResponse(remotePlan.plan, {
    acceptedOutgoingUpdateIds: [],
  });
  return { ...materialized, behindSnapshot, remoteDocument, response };
}
