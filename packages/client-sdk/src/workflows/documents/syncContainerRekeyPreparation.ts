import { KeyingVerificationError } from "@tearleads/crypto";
import type { DocumentWriterProjectionResponse } from "@tearleads/validators/response";
import { acknowledgeContainerMutation } from "../../data/containers/shared/mutationAcknowledgement";
import type { MaterializedContainerRekeyPlan } from "../../data/containers/shared/types";
import { assertDocumentWriterProjectionConsistent } from "../../data/documents/shared/projection";
import { projectionVerificationOptions } from "../../data/documents/shared/types";
import { assertProjectionVerificationCurrent } from "../../data/keyingProjectionVerification/types";
import type { SyncRemoteDocumentInput } from "./readOnlySync";
import { buildAutomaticContainerRekeys } from "./syncAutomaticContainerRekeys";
import { refreshSyncAttemptWriterProjection } from "./syncFailures";

async function commitRepairPrefix(input: {
  plans: readonly MaterializedContainerRekeyPlan[];
  repairedIds: Set<string>;
  sync: SyncRemoteDocumentInput;
}): Promise<void> {
  for (const { plan } of input.plans) {
    assertProjectionVerificationCurrent(input.sync.stillCurrent);
    if (input.sync.isRemoteSyncBlocked?.(plan.state.organizationId)) {
      throw new Error(
        "Document ancestor repair is blocked for this organization",
      );
    }
    if (input.repairedIds.has(plan.containerId)) {
      throw new Error("An ancestor changed during repair; retry document sync");
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
    if (!response) throw new Error("Document ancestor repair was refused");
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
    await commitRepairPrefix({ plans: batch.plans, repairedIds, sync });
    const fresh = await refreshSyncAttemptWriterProjection({
      apiClient: sync.apiClient,
      documentId: sync.documentId,
      onRemoteDocumentDeleted: sync.onRemoteDocumentDeleted,
      onSyncAbandoned: sync.onSyncAbandoned,
      onSyncTrace: sync.onSyncTrace,
      stillCurrent: sync.stillCurrent,
    });
    if (!fresh) {
      // refreshSyncAttemptWriterProjection returns null on a generation flip.
      assertProjectionVerificationCurrent(sync.stillCurrent);
      throw new Error("Document ancestor repair projection is unavailable");
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
