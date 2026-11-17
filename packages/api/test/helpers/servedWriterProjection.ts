import {
  type ContainerWriterProjectionResponse,
  type DocumentWriterProjectionResponse,
  decodeContainerWriterProjection,
  decodeDocumentWriterProjection,
} from "@tearleads/validators/response";

/** Resolves a served projection's manifest-hash citations, as clients do. */
export function decodeServedContainerProjection(
  value: unknown,
): ContainerWriterProjectionResponse {
  const projection = decodeContainerWriterProjection(value);
  if (!projection) {
    throw new Error("Expected a served container writer projection");
  }
  return projection;
}

/** Resolves a served projection's manifest-hash citations, as clients do. */
export function decodeServedDocumentProjection(
  value: unknown,
): DocumentWriterProjectionResponse {
  const projection = decodeDocumentWriterProjection(value);
  if (!projection) {
    throw new Error("Expected a served document writer projection");
  }
  return projection;
}
