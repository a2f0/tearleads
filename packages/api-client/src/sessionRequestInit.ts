import {
  documentSyncOperation,
  getBlobBytesOperation,
  getDocumentWriterProjectionOperation,
  type HttpOperation,
  logoutOperation,
  verifyOperation,
} from "@tearleads/validators/operation";
import type { ApiRequestInstrumentation } from "./apiRequestMetrics";
import { boundedMetadata, type MetadataLimit } from "./boundedMetadataResponse";
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

const verificationLimits = new Map<HttpOperation, MetadataLimit>([
  [getDocumentWriterProjectionOperation, "writer-projection"],
  [documentSyncOperation, "document-sync"],
  [getBlobBytesOperation, "errors"],
  [verifyOperation, "all"],
]);

const signInCleanupSignals = new WeakMap<AbortSignal, AbortSignal>();
function signInCleanupDeadline(limit: AbortSignal): AbortSignal;
function signInCleanupDeadline(
  limit: AbortSignal | undefined,
): AbortSignal | undefined;
function signInCleanupDeadline(limit: AbortSignal | undefined) {
  if (!limit) return undefined;
  const existing = signInCleanupSignals.get(limit);
  if (existing) return existing;
  const cleanup = new AbortController();
  const expire = () => setTimeout(() => cleanup.abort(), 5_000);
  if (limit.aborted) expire();
  else limit.addEventListener("abort", expire, { once: true });
  signInCleanupSignals.set(limit, cleanup.signal);
  return cleanup.signal;
}

function workDeadline(
  operation: HttpOperation | undefined,
  policy: ApiRequestInstrumentation | undefined,
  phase: "dispatch" | "response",
) {
  const command = policy?.requestSignal;
  const limit = policy?.verificationDeadline;
  // Once verification can issue a token, receive its reply so logout can use it.
  // A stopped command can never start another verification.
  if (
    operation === verifyOperation &&
    (command || limit) &&
    (phase === "response" || (!command?.aborted && !limit?.aborted))
  )
    return command && limit
      ? AbortSignal.any([
          signInCleanupDeadline(command),
          signInCleanupDeadline(limit),
        ])
      : signInCleanupDeadline(command ?? limit);
  return limit && command
    ? AbortSignal.any([limit, command])
    : (limit ?? command);
}

export function verificationRequestOptions(
  options: RequestResultOptions,
  operation: HttpOperation | undefined,
  policy?: ApiRequestInstrumentation,
  phase: "dispatch" | "response" = "dispatch",
): RequestResultOptions {
  const deadline = workDeadline(operation, policy, phase);
  if (!deadline) return options;
  if (operation === logoutOperation)
    return policy?.verificationDeadline
      ? { ...options, [boundedMetadata]: "all" }
      : options;
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
    phase: "dispatch" | "response" = "dispatch",
  ) => verificationRequestOptions(options, operation, policy, phase);
  const send =
    policy?.verificationDeadline || policy?.requestSignal
      ? (...args: Parameters<OperationResponseRequestFn>) => {
          args[3] = optionsFor(args[3], args[5]);
          return request(...args);
        }
      : request;
  return Object.assign(send, { optionsFor, reportFailure, sessionSignal });
}
