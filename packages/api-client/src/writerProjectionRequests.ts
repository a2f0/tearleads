import {
  getContainerWriterProjectionOperation,
  getDocumentWriterProjectionOperation,
} from "@tearleads/validators/operation";
import {
  type AccessManifestBundleWireResponse,
  decodeContainerWriterProjection,
  decodeDocumentWriterProjection,
} from "@tearleads/validators/response";
import type { ApiRequestRuntime } from "./apiRequestRuntime";
import { principalHistoryRequest } from "./principalHistoryRequest";
import type {
  OperationRequestFn,
  OperationRequestResultFn,
  RequestResult,
  RequestResultOptions,
} from "./types";
import {
  heldManifestCitations,
  type VerifiedManifestCitations,
  type WriterProjectionTarget,
} from "./verifiedManifestCitations";

type HeldBundles = ReadonlyMap<string, AccessManifestBundleWireResponse>;

const PROJECTION_PATH =
  /^\/(?:containers|documents)\/([^/?#]+)\/writer-projection$/u;

function writerProjectionKind(
  operationId: string,
): WriterProjectionTarget["kind"] | null {
  if (operationId === "containers.writerProjection.get") return "container";
  if (operationId === "documents.writerProjection.get") return "document";
  return null;
}

function readProjection<T>(
  runtime: ApiRequestRuntime,
  input: {
    readonly kind: WriterProjectionTarget["kind"];
    readonly path: string;
    readonly validator: (value: unknown) => value is T;
  },
  held: HeldBundles,
  options: RequestResultOptions,
): Promise<RequestResult<T>> {
  const container = input.kind === "container";
  return principalHistoryRequest(runtime, {
    path: input.path,
    validator: input.validator,
    decode: (value) =>
      container
        ? decodeContainerWriterProjection(value, held)
        : decodeDocumentWriterProjection(value, held),
    method: "GET",
    options:
      held.size === 0
        ? options
        : {
            ...options,
            headers: { "x-known-manifests": [...held.keys()].join(",") },
            reportErrors: false,
          },
    operation: container
      ? getContainerWriterProjectionOperation
      : getDocumentWriterProjectionOperation,
  });
}

/**
 * Preparation and body deadlines sit inside the projection read. The wire
 * cites each manifest bundle by hash; decoding resolves every citation, from
 * the response or from the exact bytes this request declared held, before any
 * validator, cache, or verifier sees the projection. A response this device
 * cannot rebuild fails closed into one complete, hint-free refetch.
 */
async function citedProjectionRead<T>(
  runtime: ApiRequestRuntime,
  citations: VerifiedManifestCitations | null,
  input: {
    readonly kind: WriterProjectionTarget["kind"];
    readonly path: string;
    readonly validator: (value: unknown) => value is T;
  },
  options: RequestResultOptions,
): Promise<RequestResult<T>> {
  const id = PROJECTION_PATH.exec(input.path)?.[1];
  // Caller-specific headers make a request its own; it cites nothing.
  const held =
    id === undefined || options.headers !== undefined
      ? new Map<string, AccessManifestBundleWireResponse>()
      : await heldManifestCitations(citations, {
          kind: input.kind,
          id: decodeURIComponent(id),
        });
  if (held.size === 0) return readProjection(runtime, input, held, options);
  const hinted = await readProjection(runtime, input, held, options);
  if (hinted.ok) return hinted;
  if (hinted.kind !== "shape") {
    if (options.reportErrors !== false) hinted.report();
    return hinted;
  }
  return readProjection(runtime, input, new Map(), options);
}

export function writerProjectionRequests(
  runtime: ApiRequestRuntime,
  citations: () => VerifiedManifestCitations | null,
): {
  request: OperationRequestFn;
  requestResult: OperationRequestResultFn;
} {
  const requestResult: OperationRequestResultFn = (
    path,
    validator,
    method,
    body,
    options,
    operation,
  ) => {
    const kind = method === "GET" ? writerProjectionKind(operation.id) : null;
    if (kind)
      return citedProjectionRead(
        runtime,
        citations(),
        { kind, path, validator },
        options ?? {},
      );
    return runtime.requestResult(
      path,
      validator,
      method,
      body,
      options,
      operation,
    );
  };
  const request: OperationRequestFn = async (...args) => {
    const result = await requestResult(...args);
    return result.ok ? result.data : null;
  };
  return { request, requestResult };
}
