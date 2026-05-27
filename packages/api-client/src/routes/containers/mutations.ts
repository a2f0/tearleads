import type {
  ContainerCreateWithMetadataDocumentRequest,
  ContainerMutationRequest,
} from "@tearleads/validators/request";
import {
  isContainerCreateWithMetadataDocumentResponse,
  isContainerDeleteResponse,
  isContainerMutationResponse,
} from "@tearleads/validators/response";
import type { RequestFn } from "../../types";
import { pathSegment } from "../path";

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

export function createContainerWithMetadataDocument(
  request: RequestFn,
  input: ContainerCreateWithMetadataDocumentRequest,
) {
  return request(
    "/containers/with-metadata-document",
    isContainerCreateWithMetadataDocumentResponse,
    "POST",
    JSON.stringify(input),
  );
}

export function shareContainer(
  request: RequestFn,
  containerId: string,
  input: ContainerMutationRequest,
) {
  return postContainerMutation(
    request,
    `/containers/${pathSegment(containerId)}/share`,
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
    `/containers/${pathSegment(containerId)}/revoke`,
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
    `/containers/${pathSegment(containerId)}/rekey`,
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
    `/containers/${pathSegment(containerId)}/move`,
    input,
  );
}

export function deleteContainer(request: RequestFn, containerId: string) {
  return request(
    `/containers/${pathSegment(containerId)}`,
    isContainerDeleteResponse,
    "DELETE",
  );
}
