import { KeyingVerificationError } from "@tearleads/crypto";
import type { DocumentWriterProjectionResponse } from "@tearleads/validators/response";
import { acknowledgeContainerMutation } from "../../data/containers/shared/mutationAcknowledgement";
import type { MaterializedContainerRekeyPlan } from "../../data/containers/shared/types";
import { ContainerKekRepairRequiredError } from "../../data/documents/shared/containerKekCurrency";
import { assertDocumentWriterProjectionConsistent } from "../../data/documents/shared/projection";
import { projectionVerificationOptions } from "../../data/documents/shared/types";
import type { SyncRemoteDocumentInput } from "./readOnlySync";
import { buildAutomaticContainerRekeys } from "./syncAutomaticContainerRekeys";
import { refreshSyncAttemptWriterProjection } from "./syncFailures";

async function commitRepairPrefix(input: {
  plans: readonly MaterializedContainerRekeyPlan[];
  repairedIds: Set<string>;
  sync: SyncRemoteDocumentInput;
}): Promise<void> {
  for (const { plan } of input.plans) {
    if (input.sync.stillCurrent?.() === false) {
      throw new Error("Document ancestor repair was superseded");
    }
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
    if (!response) {
      throw new ContainerKekRepairRequiredError(plan.containerId);
    }
    const acknowledged = await acknowledgeContainerMutation({
      execSql: input.sync.execSql,
      plan,
      response,
      stillCurrent: input.sync.stillCurrent,
    });
    if (!acknowledged)
      throw new Error("Document ancestor repair was superseded");
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
    // Only the standalone path needs its own gate: an inline batch rides the
    // document write and already reaches the existing blocked stop. Returning
    // no repairs keeps that single graceful outcome rather than throwing once a
    // stale chain happens to exceed the inline limit.
    if (sync.isRemoteSyncBlocked?.(sync.author.organizationId)) {
      return { plans: [], projection: initialProjection };
    }
    // Standalone mutations require authentic document scope before any request.
    await assertDocumentWriterProjectionConsistent(projection, {
      ...projectionVerificationOptions(sync),
      persistVerificationCheckpoints: false,
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
      throw new ContainerKekRepairRequiredError(sync.documentId);
    }
    projection = fresh;
  }
}
