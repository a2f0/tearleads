import { expect, test } from "bun:test";
import { bytesToBase64 } from "@tearleads/encoding";
import {
  createDocument,
  encodeVersionVector,
  exportFullHistorySnapshot,
  getTextValue,
  getUpdateVersionVectors,
  importUpdates,
} from "@tearleads/loro";
import {
  createMaterializedSyncFixture,
  createPendingUpdateRecord,
  createSignedSyncResponseUpdate,
  createSyncResponse,
} from "../../../../test/helpers/documentFixtures";
import { buildMaterializedDocumentSyncPlan } from "../../../workflows/documents/syncPlanMaterial";
import { decryptDocumentSyncUpdatesByEpoch } from "./crypto";

/**
 * Repro for the highest-severity finding of the LoroDoc scrub: a reader added
 * after a container-KEK rotation (a revoke/rekey) cannot converge.
 *
 * Scenario: a document accrued writes under content-key epoch N (wrapped to the
 * pre-rotation container-KEK epoch). A revoke rotates the container KEK and the
 * document content key to epoch N+1, and a NEW reader is granted under N+1. On
 * the newcomer's first sync the server's frontier diff has no readable-epoch
 * filter, so it returns BOTH the post-rotation rotate_baseline (epoch N+1, which
 * the newcomer CAN decrypt) AND the pre-rotation updates (epoch N, which the
 * newcomer canNOT decrypt — it holds no wrap for the superseded KEK epoch).
 *
 * `decryptDocumentSyncUpdatesByEpoch` runs `Promise.all` over the whole batch and
 * throws on the first update whose epoch key is missing. So the undecryptable
 * old-epoch sibling poisons the entire import: the newcomer never imports the
 * baseline that would have converged it, and retries the same failing batch
 * forever. The decrypt is all-or-nothing; the rotate_baseline cannot rescue it.
 *
 * The numeric relationship of the epochs is immaterial — what matters is that the
 * batch contains one epoch the reader cannot unwrap.
 *
 * This characterizes the (unchanged) client decrypt invariant: a mixed-epoch
 * batch is fatal. The fix is server-side — see the coverage-gated baseline
 * redirect in `documentSyncBaselineRedirect.ts`, which keeps the server from ever
 * assembling such a batch for a post-rotation reader.
 */
test("a post-rotation reader is stranded: one undecryptable epoch fails the whole batch", async () => {
  const { author, contentKey, secretKey, writerProjection } =
    await createMaterializedSyncFixture();
  const baselineDocument = await createDocument("post-rotation-baseline");
  baselineDocument.getText("text").update("post-rotation baseline state");
  baselineDocument.commit();
  const baselineBytes = exportFullHistorySnapshot(baselineDocument);
  const baselineVectors = getUpdateVersionVectors(baselineBytes);

  // The post-rotation rotate_baseline: full state re-encrypted under the new
  // content-key epoch, which the newcomer holds the key for.
  const materialized = await buildMaterializedDocumentSyncPlan({
    author,
    localVersionVector: null,
    pendingUpdates: [
      createPendingUpdateRecord({
        updateData: bytesToBase64(baselineBytes),
        partialEndVersionVector: baselineVectors.partialEndVersionVector,
        partialStartVersionVector: baselineVectors.partialStartVersionVector,
        sourceVersionVector: encodeVersionVector(baselineDocument),
      }),
    ],
    signedAt: "2026-04-27T00:00:00.000Z",
    targetSecretKey: secretKey,
    trustedLocalProjection: true,
    writerProjection,
  });
  const response = await createSyncResponse(materialized.plan);
  const newEpoch = materialized.plan.contentKeyEpoch;
  const baselineUpdate = response.updates[0];
  if (!baselineUpdate) {
    throw new Error("Expected a baseline update in the sync response");
  }

  // A pre-rotation update under an epoch the newcomer cannot unwrap.
  const preRotationEpoch = newEpoch + 1;
  const strandedUpdate = await createSignedSyncResponseUpdate({
    accessManifestHash: materialized.plan.expectedLinkSetManifestHash,
    author,
    contentKeyEpoch: preRotationEpoch,
    id: "550e8400-e29b-41d4-a716-4466554400aa",
    plan: materialized.plan,
    targetHash: materialized.plan.expectedTargetHash,
  });

  // The newcomer holds ONLY the post-rotation content key.
  const newcomerKeysByEpoch = new Map([[newEpoch, contentKey]]);

  // The baseline ALONE decrypts cleanly: the state the newcomer needs to
  // converge is fully recoverable from the post-rotation epoch it can read.
  const baselineOnly = await decryptDocumentSyncUpdatesByEpoch({
    contentKeysByEpoch: newcomerKeysByEpoch,
    documentId: materialized.plan.documentId,
    organizationId: materialized.plan.organizationId,
    updates: [baselineUpdate],
  });
  expect(baselineOnly).toHaveLength(1);
  const baselineUpdateData = baselineOnly[0]?.updateData;
  if (!baselineUpdateData) {
    throw new Error("Expected decrypted baseline update data");
  }
  const newcomer = await createDocument("post-rotation-newcomer");
  importUpdates(newcomer, [baselineUpdateData]);
  expect(getTextValue(newcomer)).toBe("post-rotation baseline state");

  // But the batch the server actually returns (pre-rotation update + baseline)
  // throws on the undecryptable sibling and yields NOTHING — the newcomer cannot
  // import even the baseline, so it never converges.
  await expect(
    decryptDocumentSyncUpdatesByEpoch({
      contentKeysByEpoch: newcomerKeysByEpoch,
      documentId: materialized.plan.documentId,
      organizationId: materialized.plan.organizationId,
      updates: [strandedUpdate, baselineUpdate],
    }),
  ).rejects.toThrow("Document content key missing for sync update epoch");
});
