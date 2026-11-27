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

export type RequestFailureHints = Pick<
  RequestFailure,
  | "peerFrontiers"
  | "requiredContainerIds"
  | "stalePrincipalHeads"
  | "systemSlotTaken"
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

// A container create refused because its organization already holds the
// system slot. Final for that create; the client folds its copy instead.
export function systemSlotTakenField(
  value: object,
  schema?: FailureResponseSchema,
) {
  return schema === ContainerMutationFailureResponseSchema &&
    Reflect.get(value, "systemSlotTaken") === true
    ? { systemSlotTaken: true as const }
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
    ...(input.systemSlotTaken ? { systemSlotTaken: true } : {}),
  };
}
