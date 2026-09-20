import { KeyingVerificationError } from "@tearleads/crypto";
import type { DocumentWriterProjectionResponse } from "@tearleads/validators/response";
import { MAX_DOCUMENT_SYNC_AUTHORIZATION_PATH_DEPTH } from "@tearleads/validators/util";
import { acknowledgeContainerMutation } from "../../data/containers/shared/mutationAcknowledgement";
import type { MaterializedContainerRekeyPlan } from "../../data/containers/shared/types";
import { assertDocumentWriterProjectionConsistent } from "../../data/documents/shared/projection";
import { projectionVerificationOptions } from "../../data/documents/shared/types";
import { assertProjectionVerificationCurrent } from "../../data/keyingProjectionVerification/types";
import type { SyncRemoteDocumentInput } from "./readOnlySync";
import { buildAutomaticContainerRekeys } from "./syncAutomaticContainerRekeys";
import { refreshSyncAttemptWriterProjection } from "./syncFailures";
import type { AncestorRepairAbandonReason } from "./syncTrace";

/**
 * A repair that cannot proceed for a routine reason: the organization's writes
 * are gated, the server refused the rekey, or a peer rotated an ancestor
 * mid-pass. None is a defect, so the sync lane abandons the attempt rather than
 * reporting a failed run; the next trigger re-plans from a fresh projection.
 */
export class DocumentAncestorRepairAbandonedError extends Error {
  constructor(readonly reason: AncestorRepairAbandonReason) {
    super(`Document ancestor repair abandoned: ${reason}`);
    this.name = "DocumentAncestorRepairAbandonedError";
  }
}

/**
 * Repairs committed during one sync pass, keyed by the pass's own input object
 * (stable across all three attempts). `retrySyncPlan` re-invokes plan building,
 * so a counter local to one preparation call bounds only that call and a pass
 * could commit several times the budget.
 */
const passRepairTotals = new WeakMap<SyncRemoteDocumentInput, number>();

async function commitRepairPrefix(input: {
  plans: readonly MaterializedContainerRekeyPlan[];
  repairedIds: Set<string>;
  sync: SyncRemoteDocumentInput;
}): Promise<void> {
  for (const { plan } of input.plans) {
    assertProjectionVerificationCurrent(input.sync.stillCurrent);
    if (input.sync.isRemoteSyncBlocked?.(plan.state.organizationId)) {
      throw new DocumentAncestorRepairAbandonedError("blocked");
    }
    if (input.repairedIds.has(plan.containerId)) {
      throw new DocumentAncestorRepairAbandonedError("peer-rotation");
    }
    const response = await input.sync.apiClient.rekeyContainer(
      plan.containerId,
      plan.request,
      { expectedPaymentRequiredOrganizationId: plan.state.organizationId },
    );
    // Deliberately not ContainerKekRepairRequiredError: that is classified as
    // retryable, so a handled refusal (402/409) would re-sign the whole prefix
    // before failing again, and the retry never reaches onTerminalSubmitFailure
    // regardless, because this throws before submission.
    if (!response) {
      // Deliberately not recorded as a terminal submit failure: rekeyContainer
      // answers null for every failure, so a 5xx or an offline blip is
      // indistinguishable from the 403 that follows revoked ancestor access.
      // Marking those terminal would show a document's queued writes as blocked
      // on a transient error. Recording a genuine refusal needs a
      // status-bearing rekey in @tearleads/api-client; see #2329.
      throw new DocumentAncestorRepairAbandonedError("refused");
    }
    const acknowledged = await acknowledgeContainerMutation({
      execSql: input.sync.execSql,
      plan,
      response,
      stillCurrent: input.sync.stillCurrent,
    });
    if (!acknowledged) {
      // A refused guarded transaction is usually a generation flip; surface it
      // as the shared cancellation so syncRemoteDocument returns null instead
      // of reporting a routine flip as a sync failure.
      assertProjectionVerificationCurrent(input.sync.stillCurrent);
      throw new Error("Document ancestor repair was superseded");
    }
    input.repairedIds.add(plan.containerId);
  }
}

/** Large repairs commit a bounded prefix; the last batch remains atomic with content. */
export async function prepareAutomaticContainerRekeys(
  sync: SyncRemoteDocumentInput,
  initialProjection: DocumentWriterProjectionResponse,
): Promise<{
  plans: readonly MaterializedContainerRekeyPlan[];
  projection: DocumentWriterProjectionResponse;
}> {
  if (initialProjection.documentId !== sync.documentId) {
    throw new KeyingVerificationError(
      "object_mismatch",
      "Document ancestor repair projection targets another document",
    );
  }
  let projection = initialProjection;
  const repairedIds = new Set<string>();
  // `repairedIds` only breaks a loop within one call, and retrySyncPlan can
  // re-enter plan building several times per pass with a fresh set. Bound the
  // work by the deepest authorizing path the protocol allows, counted across
  // the whole pass rather than per call: no honest chain needs more repairs
  // than that, so re-entry cannot multiply the budget.
  for (;;) {
    const batch = await buildAutomaticContainerRekeys(sync, projection);
    if (!batch.hasMore) return { plans: batch.plans, projection };
    // Standalone mutations require authentic document scope before any request.
    // Persist the verified heads here, unlike the inline path: a committed
    // repair is acknowledged against the latest durable pin, and a repaired
    // ancestor is always past epoch 1, so a device that has never pinned it
    // would reject its own acknowledgement after the server already committed
    // the rekey. The inline path needs no pin because the sync response
    // re-verifies and pins before anything is acknowledged.
    await assertDocumentWriterProjectionConsistent(projection, {
      ...projectionVerificationOptions(sync),
      persistVerificationCheckpoints: true,
      allowStaleContentKeyBundle: true,
    });
    const totalRepairs = (passRepairTotals.get(sync) ?? 0) + batch.plans.length;
    passRepairTotals.set(sync, totalRepairs);
    if (totalRepairs > MAX_DOCUMENT_SYNC_AUTHORIZATION_PATH_DEPTH) {
      throw new DocumentAncestorRepairAbandonedError("depth-budget");
    }
    await commitRepairPrefix({ plans: batch.plans, repairedIds, sync });
    const fresh = await refreshSyncAttemptWriterProjection({
      apiClient: sync.apiClient,
      documentId: sync.documentId,
      onRemoteDocumentDeleted: sync.onRemoteDocumentDeleted,
      onSyncAbandoned: sync.onSyncAbandoned,
      onSyncTrace: sync.onSyncTrace,
      // Always a write-bearing pass, so a terminal projection failure (a 403
      // after revocation mid-repair) must leave the durable record that the
      // queued writes are blocked. onReadOnlyProjectionFailure is documented
      // for passes without queued writes and would not apply here.
      onTerminalFailure: sync.onTerminalSubmitFailure,
      stillCurrent: sync.stillCurrent,
    });
    if (!fresh) {
      // refreshSyncAttemptWriterProjection returns null on a generation flip.
      assertProjectionVerificationCurrent(sync.stillCurrent);
      // It has already called onSyncAbandoned by this point, and on a coded 404
      // ran the verified local teardown, so a bare Error would double-signal as
      // an abandon plus a sync-lane crash.
      throw new DocumentAncestorRepairAbandonedError("unrefreshable");
    }
    // The scope check above guards the first round only; a refetched projection
    // is server-supplied too, and nothing in the refresh path proves it names
    // the document this repair is for.
    if (fresh.documentId !== sync.documentId) {
      throw new KeyingVerificationError(
        "object_mismatch",
        "Document ancestor repair projection targets another document",
      );
    }
    projection = fresh;
  }
}
