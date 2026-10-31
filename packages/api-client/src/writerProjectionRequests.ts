import {
  getContainerWriterProjectionOperation,
  getDocumentWriterProjectionOperation,
} from "@tearleads/validators/operation";
import {
  decodeContainerWriterProjection,
  decodeDocumentWriterProjection,
} from "@tearleads/validators/response";
import { formatKnownManifestHints } from "@tearleads/validators/util";
import type { ApiRequestRuntime } from "./apiRequestRuntime";
import { principalHistoryRequest } from "./principalHistoryRequest";
import { PrincipalHistoryRequestContext } from "./principalHistoryRequestContext";
import type {
  OperationRequestFn,
  OperationRequestResultFn,
  RequestResult,
  RequestResultOptions,
} from "./types";
import {
  type HeldProjectionCitations,
  heldManifestCitations,
  type VerifiedManifestCitations,
  type WriterProjectionTarget,
} from "./verifiedManifestCitations";

const NO_CITATIONS: HeldProjectionCitations = {
  bundles: new Map(),
  kekLevels: new Map(),
};

const PROJECTION_PATH =
  /^\/(?:containers|documents)\/([^/?#]+)\/writer-projection$/u;

function projectionId(path: string): string | null {
  const encoded = PROJECTION_PATH.exec(path)?.[1];
  if (encoded === undefined) return null;
  try {
    return decodeURIComponent(encoded);
  } catch {
    return null;
  }
}

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
  held: HeldProjectionCitations,
  context: PrincipalHistoryRequestContext,
): Promise<RequestResult<T>> {
  const container = input.kind === "container";
  return principalHistoryRequest(runtime, {
    path: input.path,
    validator: input.validator,
    decode: (value) =>
      container
        ? decodeContainerWriterProjection(value, held.bundles, held.kekLevels)
        : decodeDocumentWriterProjection(value, held.bundles, held.kekLevels),
    method: "GET",
    context,
    operation: container
      ? getContainerWriterProjectionOperation
      : getDocumentWriterProjectionOperation,
  });
}

/**
 * Preparation and body deadlines sit inside the projection read. The wire
 * cites each manifest bundle by hash and may cite a held KEK level by digest;
 * decoding resolves every citation, from the response or from the exact bytes
 * this request declared held, before any validator, cache, or verifier sees
 * the projection. A response this device
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
  // Bind the identity before citations load: an account switch while they
  // load, or before the refetch, must not carry one identity's hints or
  // answer into another's session. Each request rechecks this context.
  const context = new PrincipalHistoryRequestContext(
    runtime,
    "GET",
    input.path,
    options,
  );
  const id = projectionId(input.path);
  // Caller-specific headers make a request its own; it cites nothing. The
  // caller's abort also ends a citation wait.
  const held =
    id === null || options.headers !== undefined
      ? NO_CITATIONS
      : await heldManifestCitations(
          citations,
          { kind: input.kind, id, listing: options.projectionListing },
          options.signal,
        );
  if (held.bundles.size + held.kekLevels.size === 0)
    return readProjection(runtime, input, held, context);
  const hinted = await readProjection(
    runtime,
    input,
    held,
    context.derive({
      ...options,
      headers: {
        "x-known-manifests": formatKnownManifestHints({
          manifests: [...held.bundles.keys()],
          kekLevels: [...held.kekLevels.keys()],
        }),
      },
      reportErrors: false,
    }),
  );
  if (hinted.ok) return hinted;
  if (hinted.kind !== "shape") {
    if (options.reportErrors !== false) hinted.report();
    return hinted;
  }
  return readProjection(runtime, input, NO_CITATIONS, context.derive(options));
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
