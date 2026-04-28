import type { ContainerV2MutationRequest } from "@tearleads/validators/request";
import { isContainerV2MutationResponse } from "@tearleads/validators/response";
import type { RequestFn } from "../../types";

function postContainerV2Mutation(
  request: RequestFn,
  path: string,
  input: ContainerV2MutationRequest,
) {
  return request(
    path,
    isContainerV2MutationResponse,
    "POST",
    JSON.stringify(input),
  );
}

export function createContainerV2(
  request: RequestFn,
  input: ContainerV2MutationRequest,
) {
  return postContainerV2Mutation(request, "/v2/containers", input);
}

export function shareContainerV2(
  request: RequestFn,
  containerId: string,
  input: ContainerV2MutationRequest,
) {
  return postContainerV2Mutation(
    request,
    `/v2/containers/${containerId}/share`,
    input,
  );
}

export function revokeContainerV2(
  request: RequestFn,
  containerId: string,
  input: ContainerV2MutationRequest,
) {
  return postContainerV2Mutation(
    request,
    `/v2/containers/${containerId}/revoke`,
    input,
  );
}

export function moveContainerV2(
  request: RequestFn,
  containerId: string,
  input: ContainerV2MutationRequest,
) {
  return postContainerV2Mutation(
    request,
    `/v2/containers/${containerId}/move`,
    input,
  );
}
