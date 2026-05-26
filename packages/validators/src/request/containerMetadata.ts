import type { ContainerSystemSlot } from "../containerSystemSlot";
import { isNullableContainerSystemSlot } from "../containerSystemSlot";
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
  systemSlot?: ContainerSystemSlot | null;
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
  const systemSlot = isPlainObject(value)
    ? Reflect.get(value, "systemSlot")
    : undefined;

  return (
    isPlainObject(value) &&
    (systemSlot === undefined || isNullableContainerSystemSlot(systemSlot)) &&
    isContainerMutationRequest(container) &&
    isDocumentCreateRequest(metadataDocument)
  );
}
