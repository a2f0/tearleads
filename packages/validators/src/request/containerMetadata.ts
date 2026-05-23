import { isPlainObject } from "../isPlainObject";
import {
  type ContainerMutationRequest,
  isContainerMutationRequest,
} from "./container";
import {
  type DocumentCreateRequest,
  isDocumentCreateRequest,
} from "./document";

export interface ContainerCreateWithMetadataDocumentRequest {
  container: ContainerMutationRequest;
  metadataDocument: DocumentCreateRequest;
}

export function isContainerCreateWithMetadataDocumentRequest(
  value: unknown,
): value is ContainerCreateWithMetadataDocumentRequest {
  const container = isPlainObject(value)
    ? Reflect.get(value, "container")
    : undefined;
  const metadataDocument = isPlainObject(value)
    ? Reflect.get(value, "metadataDocument")
    : undefined;

  return (
    isPlainObject(value) &&
    isContainerMutationRequest(container) &&
    isDocumentCreateRequest(metadataDocument)
  );
}
