import type { HttpOperation } from "@tearleads/validators/operation";
import {
  ContainerMutationFailureResponseSchema,
  DocumentBaselineStageConflictErrorResponseSchema,
  DocumentMutationFailureResponseSchema,
  DocumentSyncErrorResponseSchema,
  isDocumentBaselineStageConflictErrorResponse,
  isDocumentBaselineStageErrorCode,
  isDocumentPeerRebaseErrorCode,
  isDocumentSyncErrorResponse,
  isDocumentSyncStateStaleErrorResponse,
  isPrincipalPolicyStaleErrorResponse,
} from "@tearleads/validators/response";
import type { RequestFailure } from "./types";

type FailureResponseSchema = NonNullable<
  HttpOperation["failureResponses"]
>[number];

export type RequestFailureHints = Pick<
  RequestFailure,
  | "baselineStageCode"
  | "nextSegmentIndex"
  | "openStages"
  | "peerFrontiers"
  | "requiredContainerIds"
  | "stalePrincipalHeads"
>;

// Container mutations and document sync with inline container rekeys can
// carry advisory heads whose signed evidence can be recovered in pages.
export function stalePrincipalHeadsField(
  value: object,
  schema?: FailureResponseSchema,
) {
  return schema === ContainerMutationFailureResponseSchema &&
    isPrincipalPolicyStaleErrorResponse(value)
    ? { stalePrincipalHeads: value.principalHeads }
    : schema === DocumentSyncErrorResponseSchema &&
        isDocumentSyncStateStaleErrorResponse(value) &&
        value.principalHeads !== undefined
      ? { stalePrincipalHeads: value.principalHeads }
      : {};
}

// A sync that extends another user's peer, or depends on an op nobody
// committed, names each refused peer and the frontier committed on it, so the
// client can move its unsent ops off it.
export function peerFrontiersField(
  value: object,
  schema?: FailureResponseSchema,
) {
  return schema === DocumentSyncErrorResponseSchema &&
    isDocumentSyncErrorResponse(value) &&
    isDocumentPeerRebaseErrorCode(value.code) &&
    value.peerFrontiers !== undefined
    ? { peerFrontiers: value.peerFrontiers }
    : {};
}

// A sync or unlink that commits a staged rotation baseline names what the
// refusal means for the stage beside its own code, and a stage route that
// refuses a segment out of order names the index it expects, so the writer
// knows whether to re-sign, resume, append or start over.
export function baselineStageFields(
  value: object,
  schema?: FailureResponseSchema,
): Pick<
  RequestFailureHints,
  "baselineStageCode" | "nextSegmentIndex" | "openStages"
> {
  if (
    (schema === DocumentSyncErrorResponseSchema ||
      schema === DocumentMutationFailureResponseSchema) &&
    "baselineStageCode" in value &&
    isDocumentBaselineStageErrorCode(value.baselineStageCode)
  ) {
    return { baselineStageCode: value.baselineStageCode };
  }
  if (
    schema !== DocumentBaselineStageConflictErrorResponseSchema ||
    !isDocumentBaselineStageConflictErrorResponse(value)
  ) {
    return {};
  }
  return {
    ...(value.nextSegmentIndex === undefined
      ? {}
      : { nextSegmentIndex: value.nextSegmentIndex }),
    ...(value.openStages === undefined ? {} : { openStages: value.openStages }),
  };
}

/** A failure's recovery hints, each set only when its body carried it. */
export function requestFailureHints(
  input: RequestFailureHints,
): RequestFailureHints {
  return {
    ...(input.stalePrincipalHeads
      ? { stalePrincipalHeads: input.stalePrincipalHeads }
      : {}),
    ...(input.requiredContainerIds
      ? { requiredContainerIds: input.requiredContainerIds }
      : {}),
    ...(input.peerFrontiers ? { peerFrontiers: input.peerFrontiers } : {}),
    ...(input.baselineStageCode
      ? { baselineStageCode: input.baselineStageCode }
      : {}),
    ...(input.nextSegmentIndex === undefined
      ? {}
      : { nextSegmentIndex: input.nextSegmentIndex }),
    ...(input.openStages ? { openStages: input.openStages } : {}),
  };
}
