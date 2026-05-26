import type { ContainerBuiltinKind } from "../containerBuiltin";
import { isNullableContainerBuiltinKind } from "../containerBuiltin";
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
  builtinKind?: ContainerBuiltinKind | null;
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
  const builtinKind = isPlainObject(value)
    ? Reflect.get(value, "builtinKind")
    : undefined;

  return (
    isPlainObject(value) &&
    (builtinKind === undefined ||
      isNullableContainerBuiltinKind(builtinKind)) &&
    isContainerMutationRequest(container) &&
    isDocumentCreateRequest(metadataDocument)
  );
}
