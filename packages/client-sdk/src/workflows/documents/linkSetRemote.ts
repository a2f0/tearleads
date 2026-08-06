import type { DocumentLinkSetMutationRequest } from "@tearleads/validators/request";
import type {
  ContainerWriterProjectionResponse,
  DocumentLinkSetMutationResponse,
  DocumentWriterProjectionResponse,
} from "@tearleads/validators/response";
import type {
  DocumentCreateAuthor,
  DocumentLinkSetFailureHandler,
  DocumentLinkSetMutationApi,
  DocumentLinkSetMutationOperation,
  RelinkRemoteDocumentResult,
} from "../../data/documents/shared/types";
import {
  type ProjectionUserKeyResolver,
  type ReferencedPrincipalPolicyWarmer,
  requireProjectionUserKeyResolver,
} from "../../data/keyingProjectionVerification";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import { buildMaterializedDocumentLinkSetMutationPlan } from "./linkSet";
import { persistAcknowledgedLinkSetState } from "./linkSetAcknowledgement";
import { seedLinkSetWriterProjection } from "./linkSetProjectionSeed";
import { completeLinkSetMutationRequest } from "./rotationBaseline";

async function submitLinkSetMutation(input: {
  apiClient: DocumentLinkSetMutationApi;
  documentId: string;
  onFailure?: DocumentLinkSetFailureHandler | undefined;
  operation: DocumentLinkSetMutationOperation;
  request: DocumentLinkSetMutationRequest;
}): Promise<DocumentLinkSetMutationResponse | null> {
  const { apiClient } = input;
  // Prefer the result-returning variants so a failure keeps its HTTP status
  // instead of collapsing to null — the move-intent queue records it.
  const resultFn =
    input.operation === "link"
      ? apiClient.linkDocumentResult?.bind(apiClient)
      : apiClient.unlinkDocumentResult?.bind(apiClient);
  if (resultFn) {
    const result = await resultFn(input.documentId, input.request);
    if (result.ok) {
      return result.data;
    }
    input.onFailure?.({ message: result.message, status: result.status });
    return null;
  }

  const response =
    input.operation === "link"
      ? await apiClient.linkDocument(input.documentId, input.request)
      : await apiClient.unlinkDocument(input.documentId, input.request);
  if (!response) {
    input.onFailure?.({
      message: `Document ${input.operation} request failed`,
      status: null,
    });
  }
  return response;
}

interface LinkSetProjectionFetch<TProjection> {
  failure: { message: string; status: number | null } | null;
  projection: TProjection | null;
}

// Cold-cache projection fetches must keep their HTTP status: collapsing a
// 403 to null would leave an access-denied link/unlink routinely retriable
// instead of parking its move for the access-restored signal (row 7).
async function fetchLinkSetDocumentProjection(
  apiClient: DocumentLinkSetMutationApi,
  documentId: string,
): Promise<LinkSetProjectionFetch<DocumentWriterProjectionResponse>> {
  if (apiClient.getDocumentWriterProjectionResult) {
    const result = await apiClient.getDocumentWriterProjectionResult(
      documentId,
      { reportErrors: false },
    );
    if (result.ok) {
      return { failure: null, projection: result.data };
    }
    result.report();
    return {
      failure: { message: result.message, status: result.status },
      projection: null,
    };
  }
  const projection = await apiClient.getDocumentWriterProjection(documentId);
  return projection
    ? { failure: null, projection }
    : {
        failure: {
          message: "Document writer projection is unavailable",
          status: null,
        },
        projection: null,
      };
}

async function fetchLinkSetContainerProjection(
  apiClient: DocumentLinkSetMutationApi,
  containerId: string,
): Promise<LinkSetProjectionFetch<ContainerWriterProjectionResponse>> {
  if (apiClient.getContainerWriterProjectionResult) {
    const result = await apiClient.getContainerWriterProjectionResult(
      containerId,
      { reportErrors: false },
    );
    if (result.ok) {
      return { failure: null, projection: result.data };
    }
    result.report();
    return {
      failure: { message: result.message, status: result.status },
      projection: null,
    };
  }
  const projection = await apiClient.getContainerWriterProjection(containerId);
  return projection
    ? { failure: null, projection }
    : {
        failure: {
          message: "Container writer projection is unavailable",
          status: null,
        },
        projection: null,
      };
}

export async function relinkRemoteDocument(input: {
  apiClient: DocumentLinkSetMutationApi;
  author: DocumentCreateAuthor;
  contentKey?: Uint8Array | undefined;
  documentId: string;
  eventId?: string | undefined;
  execSql: ExecSql;
  onFailure?: DocumentLinkSetFailureHandler | undefined;
  operation: DocumentLinkSetMutationOperation;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  rotationSnapshot?: Uint8Array | undefined;
  signedAt?: string | undefined;
  targetContainerId: string;
  targetSecretKey: Uint8Array;
  warmReferencedPrincipalPolicies?: ReferencedPrincipalPolicyWarmer | undefined;
}): Promise<RelinkRemoteDocumentResult | null> {
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
  // A 403 from either fetch wins the report: any permission denial in the
  // pass parks the move (row 7), so a non-403 document failure must not mask
  // a container denial when both fetches fail.
  const fetchFailures = [writerFetch.failure, targetContainerFetch.failure];
  const projectionFailure =
    fetchFailures.find((failure) => failure?.status === 403) ??
    fetchFailures.find((failure) => failure !== null) ??
    null;
  if (!writerFetch.projection || !targetContainerFetch.projection) {
    if (projectionFailure) {
      input.onFailure?.(projectionFailure);
    }
    return null;
  }
  const writerProjection = writerFetch.projection;
  const targetContainerProjection = targetContainerFetch.projection;

  const signedAt = input.signedAt ?? new Date().toISOString();
  const materializedPlan = await buildMaterializedDocumentLinkSetMutationPlan({
    author: input.author,
    contentKey: input.contentKey,
    eventId: input.eventId,
    execSql: input.execSql,
    operation: input.operation,
    resolveProjectionUserKey,
    signedAt,
    targetContainerProjection,
    targetSecretKey: input.targetSecretKey,
    warmReferencedPrincipalPolicies: input.warmReferencedPrincipalPolicies,
    writerProjection,
  });
  const request = await completeLinkSetMutationRequest({
    author: input.author,
    materializedPlan,
    operation: input.operation,
    rotationSnapshot: input.rotationSnapshot,
    signedAt,
  });
  const completedPlan = { ...materializedPlan.plan, request };
  const response = await submitLinkSetMutation({
    apiClient: input.apiClient,
    documentId: completedPlan.documentId,
    onFailure: input.onFailure,
    operation: input.operation,
    request: completedPlan.request,
  });
  if (!response) {
    return null;
  }
  const persistedState = await persistAcknowledgedLinkSetState({
    execSql: input.execSql,
    plan: completedPlan,
    response,
  });

  await seedLinkSetWriterProjection({
    apiClient: input.apiClient,
    execSql: input.execSql,
    operation: input.operation,
    priorProjection: writerProjection,
    response,
    targetContainerId: input.targetContainerId,
    targetContainerProjection,
  });

  return {
    contentKey: materializedPlan.contentKey,
    contentKeyRotated: materializedPlan.contentKeyRotated,
    documentId: response.id,
    linkedContainerIds: [...materializedPlan.plan.state.linkedContainerIds],
    persistedState,
    plan: completedPlan,
    response,
  };
}
