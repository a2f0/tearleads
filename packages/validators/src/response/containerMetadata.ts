import { isPlainObject } from "../isPlainObject";
import {
  type ContainerMutationResponse,
  isContainerMutationResponse,
} from "./container";
import {
  type DocumentCreateResponse,
  isDocumentCreateResponse,
} from "./documentMutation";

export interface ContainerCreateWithMetadataDocumentResponse {
  container: ContainerMutationResponse;
  metadataDocument: DocumentCreateResponse;
}

export function isContainerCreateWithMetadataDocumentResponse(
  value: unknown,
): value is ContainerCreateWithMetadataDocumentResponse {
  const container = isPlainObject(value)
    ? Reflect.get(value, "container")
    : undefined;
  const metadataDocument = isPlainObject(value)
    ? Reflect.get(value, "metadataDocument")
    : undefined;

  return (
    isPlainObject(value) &&
    isContainerMutationResponse(container) &&
    isDocumentCreateResponse(metadataDocument)
  );
}
