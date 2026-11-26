import type { AccessEvent } from "@tearleads/crypto";
import type { HistorySegmentSizes } from "@tearleads/loro";
import type { DocumentLinkSetMutationRequest } from "@tearleads/validators/request";
import type {
  DocumentLinkSetMutationResponse,
  DocumentWriterProjectionResponse,
} from "@tearleads/validators/response";
import type {
  DocumentCreateAuthor,
  DocumentLinkSetMutationApi,
  DocumentLinkSetMutationOperation,
  MaterializedDocumentLinkSetMutationPlan,
} from "../../../data/documents/shared/types";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import { heldStagedBaselinePlan } from "../baselineStage/rotationBaselineWriter";
import {
  completeLinkSetMutationRequest,
  settleUnlinkBaselineCommit,
} from "../rotationBaseline";
import type { DocumentSyncTraceEmitter } from "../sync/syncTrace";
import type { LinkSetSubmitFailure } from "./linkSetLegMachine";

/** What a link-set leg needs to plan, complete and submit its request. */
export interface LinkSetSubmitInput {
  readonly apiClient: DocumentLinkSetMutationApi;
  readonly author: DocumentCreateAuthor;
  readonly beforeSubmit?: (() => Promise<boolean>) | undefined;
  readonly contentKey?: Uint8Array | undefined;
  readonly documentId: string;
  readonly eventId?: string | undefined;
  readonly execSql: ExecSql;
  readonly onBaselineStageTrace?: DocumentSyncTraceEmitter | undefined;
  readonly operation: DocumentLinkSetMutationOperation;
  readonly rotationBaselineSegmentSizes?: HistorySegmentSizes | undefined;
  readonly rotationSnapshot?: Uint8Array | undefined;
  readonly signedAt?: string | undefined;
  readonly stillCurrent?: (() => boolean) | undefined;
}

/** The parts of a leg's plan that every attempt to commit it shares. */
export interface FixedLinkSetPlan {
  readonly contentKey: Uint8Array | undefined;
  readonly eventId: string | undefined;
  /** The event an earlier attempt signed, kept if this one signs the same. */
  readonly signedEvent: AccessEvent | undefined;
  readonly signedAt: string;
}

/**
 * The key, event and signed time this leg plans with. An unlink whose
 * baseline is part way through a stage plans as the upload did: the same
 * key, which the stage's segments are encrypted under, and the same signed
 * event, so the manifest it writes is the one the staged headers name. Any
 * other leg plans afresh.
 */
export function fixedLinkSetPlan(
  input: LinkSetSubmitInput,
  writerProjection: DocumentWriterProjectionResponse,
): FixedLinkSetPlan {
  const unlink = input.operation === "unlink";
  const held = unlink
    ? heldStagedBaselinePlan(
        input.execSql,
        input.documentId,
        writerProjection.contentKeyBundle.contentKeyEpoch + 1,
      )
    : null;
  const signedEvent = held?.linkSetEvent;
  return {
    contentKey: input.contentKey ?? held?.contentKey,
    eventId: input.eventId ?? signedEvent?.eventId,
    signedAt:
      input.signedAt ?? signedEvent?.signedAt ?? new Date().toISOString(),
    signedEvent,
  };
}

/** How the API answered a link-set request; `ended` when it was not sent. */
type LinkSetSubmission =
  | { readonly kind: "ended" }
  | { readonly failure: LinkSetSubmitFailure; readonly kind: "refused" }
  | {
      readonly kind: "committed";
      readonly response: DocumentLinkSetMutationResponse;
    };

async function submitLinkSetMutation(
  input: LinkSetSubmitInput,
  expectedOrganizationId: string,
  request: DocumentLinkSetMutationRequest,
): Promise<LinkSetSubmission> {
  if (input.stillCurrent?.() === false) return { kind: "ended" };
  const { apiClient } = input;
  // Preserve the HTTP failure for the durable move-intent queue. Its host
  // report waits until the leg knows the refusal is not one it recovers from.
  const resultFn =
    input.operation === "link"
      ? apiClient.linkDocumentResult.bind(apiClient)
      : apiClient.unlinkDocumentResult.bind(apiClient);
  const result = await resultFn(input.documentId, request, {
    expectedPaymentRequiredOrganizationId: expectedOrganizationId,
    reportErrors: false,
  });
  if (result.ok) return { kind: "committed", response: result.data };
  const { baselineStageCode, code, message, report, status } = result;
  return {
    failure: { baselineStageCode, code, message, report, status },
    kind: "refused",
  };
}

type LinkSetLegSubmission =
  | { readonly kind: "ended" }
  | {
      readonly failure: LinkSetSubmitFailure;
      readonly kind: "refused";
      /** The refusal left staged headers to sign again before a resubmit. */
      readonly resign: boolean;
    }
  | {
      readonly completedPlan: MaterializedDocumentLinkSetMutationPlan["plan"];
      readonly kind: "committed";
      readonly response: DocumentLinkSetMutationResponse;
    };

/**
 * Complete the leg's request with its unlink's rotation baseline, submit it,
 * and tell a staged baseline what the request got.
 */
async function submitLinkSetLegOnce(
  input: LinkSetSubmitInput,
  materializedPlan: MaterializedDocumentLinkSetMutationPlan,
  fixed: FixedLinkSetPlan,
): Promise<LinkSetLegSubmission> {
  const completed = await completeLinkSetMutationRequest({
    api: input.apiClient,
    author: input.author,
    execSql: input.execSql,
    materializedPlan,
    onTrace: input.onBaselineStageTrace,
    rotationBaselineSegmentSizes: input.rotationBaselineSegmentSizes,
    rotationSnapshot: input.rotationSnapshot,
    signedAt: fixed.signedAt,
    stillCurrent: input.stillCurrent,
  });
  if (!completed) return { kind: "ended" };
  const { request, stagedCommit } = completed;
  const completedPlan = { ...materializedPlan.plan, request };
  if (input.beforeSubmit && !(await input.beforeSubmit())) {
    return { kind: "ended" };
  }
  const submission = await submitLinkSetMutation(
    input,
    completedPlan.state.organizationId,
    request,
  );
  if (submission.kind === "ended") return submission;
  if (submission.kind === "committed") {
    await settleUnlinkBaselineCommit(stagedCommit, { ok: true });
    return { ...submission, completedPlan };
  }
  const upload = await settleUnlinkBaselineCommit(stagedCommit, {
    ...submission.failure,
    ok: false,
  });
  return { ...submission, resign: upload?.status === "resigningHeaders" };
}

/**
 * Submit the leg's request. An unlink whose staged headers the commit found
 * stale signs them again and submits once more; every other refusal reaches
 * `onSubmitFailure`, and the stage it left is read by the leg's next
 * attempt. A refusal the operation no longer waits for is neither retried
 * nor reported.
 */
export async function submitLinkSetLeg(
  input: LinkSetSubmitInput,
  materializedPlan: MaterializedDocumentLinkSetMutationPlan,
  fixed: FixedLinkSetPlan,
  onSubmitFailure: (failure: LinkSetSubmitFailure) => void,
): Promise<Extract<LinkSetLegSubmission, { kind: "committed" }> | null> {
  for (let resigned = false; ; resigned = true) {
    const submission = await submitLinkSetLegOnce(
      input,
      materializedPlan,
      fixed,
    );
    if (submission.kind === "committed") return submission;
    if (submission.kind === "ended" || input.stillCurrent?.() === false) {
      return null;
    }
    if (submission.resign && !resigned) continue;
    onSubmitFailure(submission.failure);
    return null;
  }
}
