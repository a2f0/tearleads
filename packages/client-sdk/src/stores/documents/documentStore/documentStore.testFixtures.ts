import { bytesToBase64 } from "@tearleads/encoding";
import {
  createDocument,
  encodeVersionVector,
  exportAllUpdates,
  exportFullHistorySnapshot,
  exportUpdatesSince,
  getUpdateVersionVectors,
} from "@tearleads/loro";
import {
  createMaterializedSyncFixture,
  createPendingUpdateRecord,
  createSyncResponse,
} from "../../../../test/helpers/documentFixtures";
import { buildMaterializedDocumentSyncPlan } from "../../../workflows/documents/syncPlanMaterial";
import type { DocumentStorePersistenceEffects } from "./state";

/** Shared no-op persistence effects for tests that ignore registry fan-out. */
export const noopDocumentStorePersistenceEffects: DocumentStorePersistenceEffects =
  {
    emitPersistedDocument: () => undefined,
    registerDocumentIdentity: () => undefined,
  };

/**
 * A remote document whose op log spans two commits ("survives key" then
 * "survives key rotation"), materialized into a sync response a store-level
 * recovery pull can replay. The rotation-preflight and stale-heal recovery
 * tests both rebuild full history from this fixture.
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
  const firstUpdate = exportAllUpdates(remoteDocument);
  const firstEndVersion = encodeVersionVector(remoteDocument);
  remoteDocument.getText("text").update("survives key rotation");
  remoteDocument.commit();
  const secondUpdate = exportUpdatesSince(remoteDocument, firstEndVersion);
  const remotePlan = await buildMaterializedDocumentSyncPlan({
    author: materialized.author,
    localVersionVector: null,
    pendingUpdates: [
      createPendingUpdateRecord({
        id: "550e8400-e29b-41d4-a716-446655440441",
        updateData: bytesToBase64(firstUpdate),
        ...getUpdateVersionVectors(firstUpdate),
      }),
      createPendingUpdateRecord({
        id: "550e8400-e29b-41d4-a716-446655440442",
        updateData: bytesToBase64(secondUpdate),
        ...getUpdateVersionVectors(secondUpdate),
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
