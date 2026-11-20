import {
  documentSyncOperation,
  getDocumentWriterProjectionOperation,
  type HttpOperation,
  logoutOperation,
} from "@tearleads/validators/operation";
import type { ApiRequestInstrumentation } from "./apiRequestMetrics";
import { boundedMetadata } from "./boundedMetadataResponse";
import { hasHeader } from "./requestInternals";
import type {
  HttpMethod,
  OperationResponseRequestFn,
  RequestBody,
  RequestResultOptions,
} from "./types";

export function sessionRequestInit(
  method: HttpMethod,
  body: RequestBody | undefined,
  options: RequestResultOptions,
  authToken: string | null,
) {
  const headers = {
    ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    ...(typeof body === "string" && !hasHeader(options.headers, "Content-Type")
      ? { "Content-Type": "application/json" }
      : {}),
    ...options.headers,
  };
  const init: RequestInit & { duplex?: "half" } = {
    method,
    headers,
    ...(options.signal ? { signal: options.signal } : {}),
  };
  if (body !== undefined) {
    init.body = body;
    if (body instanceof ReadableStream) init.duplex = "half";
  }
  return { headers, init };
}

const verificationLimits = new Map<
  HttpOperation,
  "writer-projection" | "document-sync"
>([
  [getDocumentWriterProjectionOperation, "writer-projection"],
  [documentSyncOperation, "document-sync"],
]);

export function verificationRequestOptions(
  options: RequestResultOptions,
  operation: HttpOperation | undefined,
  policy?: ApiRequestInstrumentation,
): RequestResultOptions {
  const deadline = policy?.verificationDeadline ?? policy?.requestSignal;
  if (!deadline || operation === logoutOperation) return options;
  return {
    ...options,
    stillCurrent: () => !deadline.aborted && options.stillCurrent?.() !== false,
    signal: options.signal
      ? AbortSignal.any([options.signal, deadline])
      : deadline,
    [boundedMetadata]:
      options[boundedMetadata] ??
      (policy?.verificationDeadline && operation
        ? (verificationLimits.get(operation) ?? "verification-page")
        : undefined),
  };
}

export function sessionResponseRequest(
  request: (
    ...args: Parameters<OperationResponseRequestFn>
  ) => ReturnType<OperationResponseRequestFn>,
  reportFailure: OperationResponseRequestFn["reportFailure"],
  sessionSignal: () => AbortSignal,
  policy?: ApiRequestInstrumentation,
): OperationResponseRequestFn {
  const optionsFor = (
    options: RequestResultOptions,
    operation: HttpOperation,
  ) => verificationRequestOptions(options, operation, policy);
  const send =
    policy?.verificationDeadline || policy?.requestSignal
      ? (...args: Parameters<OperationResponseRequestFn>) => {
          args[3] = optionsFor(args[3], args[5]);
          return request(...args);
        }
      : request;
  return Object.assign(send, { optionsFor, reportFailure, sessionSignal });
}
