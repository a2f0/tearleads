import type { RequestResult } from "@tearleads/api-client";
import type { CreateOrganizationRequest } from "@tearleads/validators/request";
import type { CreateOrganizationResponse } from "@tearleads/validators/response";

export type OrganizationCreationState = {
  readonly request: CreateOrganizationRequest;
} & (
  | { readonly status: "pending" }
  | { readonly status: "refused" }
  | {
      readonly status: "received";
      readonly response: CreateOrganizationResponse;
    }
);

type OrganizationCreationEvent = {
  readonly type: "result";
  readonly request: CreateOrganizationRequest;
  readonly result: RequestResult<CreateOrganizationResponse> | null;
};

/** Pending persists across failures; received still needs local acknowledgement. */
export function transitionOrganizationCreation(
  state: OrganizationCreationState,
  event: OrganizationCreationEvent,
): OrganizationCreationState {
  if (state.status !== "pending" || state.request !== event.request)
    return state;
  const { result } = event;
  if (result?.ok) {
    return {
      status: "received",
      request: state.request,
      response: result.data,
    };
  }
  if (
    result &&
    result.kind === "http" &&
    result.status === 410 &&
    result.code === "organization_creation_purged" &&
    !state.request.replacesOrganizationId &&
    !state.request.nativeSubscriptionRestore
  ) {
    return { status: "refused", request: state.request };
  }
  // Generic 4xx, reversible unavailability, malformed and transport failures
  // do not disprove an earlier commit. Neither discovery nor time releases it.
  return state;
}
