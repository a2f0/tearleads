import type { HttpOperation } from "@tearleads/validators/operation";
import {
  ContainerMutationFailureResponseSchema,
  DocumentSyncErrorResponseSchema,
  isDocumentPeerRebaseErrorCode,
  isDocumentSyncErrorResponse,
  isDocumentSyncStateStaleErrorResponse,
  isPrincipalPolicyStaleErrorResponse,
} from "@tearleads/validators/response";
import type { RequestFailure } from "./types";

type FailureResponseSchema = NonNullable<
  HttpOperation["failureResponses"]
>[number];

type RequestFailureHints = Pick<
  RequestFailure,
  "peerFrontiers" | "requiredContainerIds" | "stalePrincipalHeads"
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
  };
}
