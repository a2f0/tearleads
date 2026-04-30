import type { ContainerMutationRequest } from "@tearleads/validators/request";
import { isContainerMutationResponse } from "@tearleads/validators/response";
import type { RequestFn } from "../../types";

function postContainerMutation(
  request: RequestFn,
  path: string,
  input: ContainerMutationRequest,
) {
  return request(
    path,
    isContainerMutationResponse,
    "POST",
    JSON.stringify(input),
  );
}

export function createContainer(
  request: RequestFn,
  input: ContainerMutationRequest,
) {
  return postContainerMutation(request, "/containers", input);
}

export function shareContainer(
  request: RequestFn,
  containerId: string,
  input: ContainerMutationRequest,
) {
  return postContainerMutation(
    request,
    `/containers/${containerId}/share`,
    input,
  );
}

export function revokeContainer(
  request: RequestFn,
  containerId: string,
  input: ContainerMutationRequest,
) {
  return postContainerMutation(
    request,
    `/containers/${containerId}/revoke`,
    input,
  );
}

export function rekeyContainer(
  request: RequestFn,
  containerId: string,
  input: ContainerMutationRequest,
) {
  return postContainerMutation(
    request,
    `/containers/${containerId}/rekey`,
    input,
  );
}

export function moveContainer(
  request: RequestFn,
  containerId: string,
  input: ContainerMutationRequest,
) {
  return postContainerMutation(
    request,
    `/containers/${containerId}/move`,
    input,
  );
}
