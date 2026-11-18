import type {
  DocumentContentKeyTarget,
  DocumentLinkAccessEventBody,
} from "@tearleads/crypto";
import type { DocumentLinkSetMutationRequest } from "@tearleads/validators/request";
import type {
  ContainerWriterProjectionResponse,
  DocumentLinkSetMutationResponse,
  DocumentWriterProjectionResponse,
} from "@tearleads/validators/response";
import {
  acknowledgedDocumentLinkSetMutation,
  persistedDocumentStateFromAcknowledgement,
} from "../../../data/documents/shared/responses";
import { acknowledgeDocumentMutation } from "../../../data/documents/shared/sync/mutationAcknowledgement";
import type { DocumentSyncSubmitFailure } from "../../../data/documents/shared/sync/syncSubmitFailure";
import type {
  DocumentCreateAuthor,
  DocumentLinkSetFailureHandler,
  DocumentLinkSetMutationApi,
  DocumentLinkSetMutationOperation,
  RelinkRemoteDocumentResult,
} from "../../../data/documents/shared/types";
import {
  nullOnProjectionVerificationCancellation,
  type ProjectionUserKeyResolver,
  type ReferencedPrincipalPolicyWarmer,
  requireProjectionUserKeyResolver,
} from "../../../data/keyingProjectionVerification";
import { documentMayHaveAttachments } from "../../../data/persistence/documents/documentAttachmentPresence";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import { recordDocumentAuthorAccessFailure } from "../authorAccessFailure";
import type { SubtreePurgeRoot } from "../purge/subtreePurgeScope";
import type { RemoteDocumentCollaborators } from "../remote/remoteDocumentCollaborators";
import { completeLinkSetMutationRequest } from "../rotationBaseline";
import { buildMaterializedDocumentLinkSetMutationPlan } from "./index";
import {
  type LinkSetAttachmentReuse,
  prepareDocumentLinkBlobRewraps,
  reuseCommittedBlobRewraps,
} from "./linkSetBlobRewraps";
import {
  holdsLinkSetRefusals,
  INITIAL_LINK_SET_LEG_STATE,
  type LinkSetLegAttempt,
  type LinkSetSubmitFailure,
  linkSetAttemptEvent,
  type PreparedLinkSetRewraps,
  recordLinkSetLegRewraps,
  startLinkSetLegAttempt,
  transitionLinkSetLeg,
} from "./linkSetLegMachine";
import { seedLinkSetWriterProjection } from "./linkSetProjectionSeed";

async function submitLinkSetMutation(input: {
  apiClient: DocumentLinkSetMutationApi;
  documentId: string;
  expectedOrganizationId: string;
  onFailure: (failure: LinkSetSubmitFailure) => void;
  operation: DocumentLinkSetMutationOperation;
  request: DocumentLinkSetMutationRequest;
  stillCurrent?: (() => boolean) | undefined;
}): Promise<DocumentLinkSetMutationResponse | null> {
  if (input.stillCurrent?.() === false) return null;
  const { apiClient } = input;
  // Preserve the HTTP failure for the durable move-intent queue. Its host
  // report waits until the leg knows the refusal is not one it recovers from.
  const resultFn =
    input.operation === "link"
      ? apiClient.linkDocumentResult.bind(apiClient)
      : apiClient.unlinkDocumentResult.bind(apiClient);
  const result = await resultFn(input.documentId, input.request, {
    expectedPaymentRequiredOrganizationId: input.expectedOrganizationId,
    reportErrors: false,
  });
  if (result.ok) {
    return result.data;
  }
  // A refusal the operation no longer waits for is neither retried nor
  // reported.
  if (input.stillCurrent?.() === false) return null;
  input.onFailure({
    code: result.code,
    message: result.message,
    report: result.report,
    status: result.status,
  });
  return null;
}

/** Hand a refusal the leg does not recover from to its host and caller. */
function reportLinkSetFailure(
  input: Pick<RelinkRemoteDocumentInput, "onFailure">,
  failure: LinkSetSubmitFailure,
): void {
  failure.report?.();
  input.onFailure?.({
    code: failure.code,
    message: failure.message,
    status: failure.status,
  });
}

interface LinkSetProjectionFetch<TProjection> {
  failure: LinkSetSubmitFailure | null;
  projection: TProjection | null;
}

// Cold-cache projection fetches must keep their HTTP status: collapsing a
// 403 to null would leave an access-denied link/unlink routinely retriable
// instead of parking its move for the access-restored signal (row 7).
async function fetchLinkSetProjection<TProjection>(input: {
  fetchProjectionResult: () => Promise<
    | { readonly data: TProjection; readonly ok: true }
    | DocumentSyncSubmitFailure
  >;
}): Promise<LinkSetProjectionFetch<TProjection>> {
  const result = await input.fetchProjectionResult();
  if (result.ok) {
    return { failure: null, projection: result.data };
  }
  return {
    failure: {
      code: result.code,
      message: result.message,
      report: result.report,
      status: result.status,
    },
    projection: null,
  };
}

function fetchLinkSetDocumentProjection(
  apiClient: DocumentLinkSetMutationApi,
  documentId: string,
): Promise<LinkSetProjectionFetch<DocumentWriterProjectionResponse>> {
  return fetchLinkSetProjection({
    fetchProjectionResult: apiClient.getDocumentWriterProjectionResult.bind(
      apiClient,
      documentId,
      { reportErrors: false },
    ),
  });
}

function fetchLinkSetContainerProjection(
  apiClient: DocumentLinkSetMutationApi,
  containerId: string,
): Promise<LinkSetProjectionFetch<ContainerWriterProjectionResponse>> {
  return fetchLinkSetProjection({
    fetchProjectionResult: apiClient.getContainerWriterProjectionResult.bind(
      apiClient,
      containerId,
      { reportErrors: false },
    ),
  });
}

async function completeRemoteDocumentLinkSet(input: {
  completedPlan: Parameters<typeof acknowledgedDocumentLinkSetMutation>[0];
  execSql: ExecSql;
  materializedPlan: Awaited<
    ReturnType<typeof buildMaterializedDocumentLinkSetMutationPlan>
  >;
  operation: DocumentLinkSetMutationOperation;
  response: DocumentLinkSetMutationResponse;
  stillCurrent?: (() => boolean) | undefined;
  targetContainerId: string;
  targetContainerProjection: ContainerWriterProjectionResponse;
  writerProjection: DocumentWriterProjectionResponse;
  apiClient: DocumentLinkSetMutationApi;
}): Promise<RelinkRemoteDocumentResult | null> {
  const acknowledged = acknowledgedDocumentLinkSetMutation(
    input.completedPlan,
    input.response,
  );
  const persistedState =
    persistedDocumentStateFromAcknowledgement(acknowledged);
  await acknowledgeDocumentMutation({
    bundleDigest: input.response.bundleDigest,
    execSql: input.execSql,
    plan: input.completedPlan,
    stillCurrent: input.stillCurrent,
  });
  await seedLinkSetWriterProjection({
    apiClient: input.apiClient,
    execSql: input.execSql,
    operation: input.operation,
    priorProjection: input.writerProjection,
    response: acknowledged,
    targetContainerId: input.targetContainerId,
    targetContainerProjection: input.targetContainerProjection,
    stillCurrent: input.stillCurrent,
  });
  if (input.stillCurrent?.() === false) return null;
  return {
    contentKey: input.materializedPlan.contentKey,
    contentKeyRotated: input.materializedPlan.contentKeyRotated,
    documentId: input.response.id,
    linkedContainerIds: [
      ...input.materializedPlan.plan.state.linkedContainerIds,
    ],
    persistedState,
    plan: input.completedPlan,
    response: input.response,
  };
}

/** What varies per link or unlink leg; the collaborators bind the rest. */
export interface RelinkRemoteDocumentRequest {
  /** Shared by the legs of one move or trash workflow. */
  attachmentReuse?: LinkSetAttachmentReuse | undefined;
  beforeSubmit?: (() => Promise<boolean>) | undefined;
  author: DocumentCreateAuthor;
  contentKey?: Uint8Array | undefined;
  documentId: string;
  expectedSubtreeRoot?: SubtreePurgeRoot | undefined;
  eventId?: string | undefined;
  onFailure?: DocumentLinkSetFailureHandler | undefined;
  operation: DocumentLinkSetMutationOperation;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  rotationSnapshot?: Uint8Array | undefined;
  signedAt?: string | undefined;
  stillCurrent?: (() => boolean) | undefined;
  targetContainerId: string;
  warmReferencedPrincipalPolicies?: ReferencedPrincipalPolicyWarmer | undefined;
}

interface RelinkRemoteDocumentInput extends RelinkRemoteDocumentRequest {
  apiClient: DocumentLinkSetMutationApi;
  execSql: ExecSql;
  targetSecretKey: Uint8Array;
}

/**
 * A leg that cited rewraps without listing and was refused because the
 * attachment set (or a re-cited key epoch) moved lists and retries once, as a
 * leg that listed would have; that first refusal is neither reported nor
 * retried once the operation is no longer current (`transitionLinkSetLeg`).
 */
export async function relinkRemoteDocument(
  remote: RemoteDocumentCollaborators,
  request: RelinkRemoteDocumentRequest,
): Promise<RelinkRemoteDocumentResult | null> {
  if (!remote.encapsulationSecretKey) {
    throw new Error(
      "Remote document link-set mutation requires an encapsulation key",
    );
  }
  const input: RelinkRemoteDocumentInput = {
    ...request,
    apiClient: remote.api,
    execSql: remote.execSql,
    targetSecretKey: remote.encapsulationSecretKey,
  };
  const reuse = input.attachmentReuse;
  let leg = INITIAL_LINK_SET_LEG_STATE;
  let result: RelinkRemoteDocumentResult | null = null;
  while (leg.status === "speculative" || leg.status === "fresh") {
    const attempt = { current: startLinkSetLegAttempt(leg) };
    const heldFailures: LinkSetSubmitFailure[] = [];
    result = await relinkRemoteDocumentOnce(input, attempt, (failure) => {
      if (holdsLinkSetRefusals(attempt.current)) heldFailures.push(failure);
      else reportLinkSetFailure(input, failure);
    }).catch((error: unknown) => {
      // A leg that threw may have committed before failing: list again next.
      if (reuse) reuse.committed = null;
      throw error;
    });
    const event = linkSetAttemptEvent({
      attempt: attempt.current,
      committed: result !== null,
      heldFailures,
      stillCurrent: input.stillCurrent?.() !== false,
    });
    if (reuse)
      reuse.committed =
        event.type === "attemptCommitted" ? event.rewraps : null;
    leg = transitionLinkSetLeg(leg, event);
  }
  if (leg.status === "failed") {
    for (const failure of leg.unreported) reportLinkSetFailure(input, failure);
  }
  return result;
}

/** The attempt in flight; preparation replaces it with what it signed. */
interface LinkSetAttemptSlot {
  current: LinkSetLegAttempt;
}

async function relinkRemoteDocumentOnce(
  input: RelinkRemoteDocumentInput,
  attempt: LinkSetAttemptSlot,
  onSubmitFailure: (failure: LinkSetSubmitFailure) => void,
): Promise<RelinkRemoteDocumentResult | null> {
  if (input.operation === "unlink" && !input.rotationSnapshot) {
    throw new Error(
      "Document unlink requires a proven full-history rotation snapshot",
    );
  }
  const resolveProjectionUserKey = requireProjectionUserKeyResolver(
    input.resolveProjectionUserKey,
    "Remote document link-set mutation",
  );
  const [writerFetch, targetContainerFetch] = await Promise.all([
    fetchLinkSetDocumentProjection(input.apiClient, input.documentId),
    fetchLinkSetContainerProjection(input.apiClient, input.targetContainerId),
  ]);
  if (!writerFetch.projection || !targetContainerFetch.projection) {
    // A failure the operation no longer waits for is not reported.
    if (input.stillCurrent?.() === false) return null;
    for (const failure of orderedProjectionFailures([
      writerFetch.failure,
      targetContainerFetch.failure,
    ])) {
      reportLinkSetFailure(input, failure);
    }
    return null;
  }
  const writerProjection = writerFetch.projection;
  const targetContainerProjection = targetContainerFetch.projection;
  if (input.stillCurrent?.() === false) return null;

  const signedAt = input.signedAt ?? new Date().toISOString();
  const materializedPlan = await prepareRemoteLinkSetMutation(
    { ...input, resolveProjectionUserKey, signedAt },
    writerProjection,
    targetContainerProjection,
    attempt,
  );
  if (!materializedPlan) return null;
  const request = await completeLinkSetMutationRequest({
    author: input.author,
    materializedPlan,
    operation: input.operation,
    rotationSnapshot: input.rotationSnapshot,
    signedAt,
  });
  const completedPlan = { ...materializedPlan.plan, request };
  if (input.beforeSubmit && !(await input.beforeSubmit())) return null;
  const response = await submitLinkSetMutation({
    apiClient: input.apiClient,
    documentId: completedPlan.documentId,
    expectedOrganizationId: completedPlan.state.organizationId,
    onFailure: onSubmitFailure,
    operation: input.operation,
    request: completedPlan.request,
    stillCurrent: input.stillCurrent,
  });
  if (!response) {
    return null;
  }
  if (input.stillCurrent?.() === false) return null;
  return completeRemoteDocumentLinkSet({
    apiClient: input.apiClient,
    completedPlan,
    execSql: input.execSql,
    materializedPlan,
    operation: input.operation,
    response,
    stillCurrent: input.stillCurrent,
    targetContainerId: input.targetContainerId,
    targetContainerProjection,
    writerProjection,
  });
}

// Every projection failure reaches the handler: the queued-move accumulator
// classifies a vanished container from ANY coded container 404, so a document
// fetch failure must not hide a container one (or vice versa). A 403 is
// delivered last, so a single-slot consumer keeps the denial that parks the
// move (row 7) while the accumulator still sees both.
function orderedProjectionFailures(
  failures: readonly (LinkSetSubmitFailure | null)[],
): LinkSetSubmitFailure[] {
  const present = failures.filter(
    (failure): failure is LinkSetSubmitFailure => failure !== null,
  );
  return [
    ...present.filter((failure) => failure.status !== 403),
    ...present.filter((failure) => failure.status === 403),
  ];
}

/**
 * Rewraps a first attempt may sign without listing: the previous leg's
 * envelopes, or none when the local view holds no attachment for the
 * document. The server's binding check at commit refuses either if stale.
 */
async function speculativeBlobRewraps(
  input: RelinkRemoteDocumentInput,
  writerProjection: DocumentWriterProjectionResponse,
  targets: readonly DocumentContentKeyTarget[],
): Promise<{
  readonly rewraps: DocumentLinkAccessEventBody["blobRewraps"];
  readonly source: "reused" | "skipped";
} | null> {
  const committed = input.attachmentReuse?.committed;
  if (committed) {
    const reused = reuseCommittedBlobRewraps({
      committed,
      documentId: writerProjection.documentId,
      targets,
    });
    if (reused) return { rewraps: reused, source: "reused" };
    // The previous leg cited attachments this leg cannot re-cite: list them.
    if (committed.length > 0) return null;
  }
  if (
    await documentMayHaveAttachments(input.execSql, writerProjection.documentId)
  )
    return null;
  return { rewraps: [], source: "skipped" };
}

function prepareRemoteLinkSetMutation(
  input: RelinkRemoteDocumentInput & {
    resolveProjectionUserKey: ProjectionUserKeyResolver;
    signedAt: string;
  },
  writerProjection: DocumentWriterProjectionResponse,
  targetContainerProjection: ContainerWriterProjectionResponse,
  attempt: LinkSetAttemptSlot,
) {
  const prepareBlobRewraps = async (
    targets: readonly DocumentContentKeyTarget[],
  ) => {
    const prepared: PreparedLinkSetRewraps = (attempt.current.listing ===
    "speculative"
      ? await speculativeBlobRewraps(input, writerProjection, targets)
      : null) ?? {
      rewraps: await prepareDocumentLinkBlobRewraps({
        ...input,
        refreshListing: attempt.current.listing === "fresh",
        targets,
        targetContainerProjection,
        writerProjection,
      }),
      source: "listed",
    };
    attempt.current = recordLinkSetLegRewraps(attempt.current, prepared);
    return prepared.rewraps;
  };
  return recordDocumentAuthorAccessFailure(
    () =>
      nullOnProjectionVerificationCancellation(() =>
        buildMaterializedDocumentLinkSetMutationPlan({
          author: input.author,
          expectedSubtreeRoot: input.expectedSubtreeRoot,
          prepareBlobRewraps,
          contentKey: input.contentKey,
          eventId: input.eventId,
          execSql: input.execSql,
          operation: input.operation,
          resolveProjectionUserKey: input.resolveProjectionUserKey,
          signedAt: input.signedAt,
          stillCurrent: input.stillCurrent,
          targetContainerProjection,
          targetSecretKey: input.targetSecretKey,
          warmReferencedPrincipalPolicies:
            input.warmReferencedPrincipalPolicies,
          writerProjection,
        }),
      ),
    input.onFailure,
  );
}
