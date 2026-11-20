import {
  getDocumentWriterProjectionOperation,
  type HttpOperation,
  logoutOperation,
} from "@tearleads/validators/operation";
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

function verificationRequestOptions(
  options: RequestResultOptions,
  operation: HttpOperation,
  deadline?: AbortSignal,
): RequestResultOptions {
  if (!deadline || operation === logoutOperation) return options;
  return {
    ...options,
    signal: options.signal
      ? AbortSignal.any([options.signal, deadline])
      : deadline,
    [boundedMetadata]:
      options[boundedMetadata] ??
      (operation === getDocumentWriterProjectionOperation
        ? "writer-projection"
        : undefined),
  };
}

export function sessionResponseRequest(
  request: (
    ...args: Parameters<OperationResponseRequestFn>
  ) => ReturnType<OperationResponseRequestFn>,
  reportFailure: OperationResponseRequestFn["reportFailure"],
  sessionSignal: () => AbortSignal,
  deadline?: AbortSignal,
): OperationResponseRequestFn {
  const send = deadline
    ? (...args: Parameters<OperationResponseRequestFn>) => {
        args[3] = verificationRequestOptions(args[3], args[5], deadline);
        return request(...args);
      }
    : request;
  return Object.assign(send, { reportFailure, sessionSignal });
}
