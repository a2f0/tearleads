import type { Event } from "@sentry/core";
import {
  API_ERROR_CODES,
  API_ERROR_TYPES,
  API_OPERATIONS,
  type ApiDiagnosticOperation,
  isVocabularyKey,
} from "./apiVocabulary";

type DiagnosticTags = Partial<
  Record<
    | "api_operation"
    | "api_error_code"
    | "api_error_status"
    | "api_cause_type"
    | "api_stack",
    string
  >
>;

// Do not execute arbitrary error-property getters while reporting a failure.
function dataProperty(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) return undefined;
  return Object.getOwnPropertyDescriptor(value, key)?.value;
}

function isErrorStatus(value: unknown): value is number {
  return (
    Number.isInteger(value) && Number(value) >= 400 && Number(value) <= 599
  );
}

export function apiErrorTags(
  error: Error,
  operation?: ApiDiagnosticOperation,
): DiagnosticTags {
  const tags: DiagnosticTags = {};
  if (isVocabularyKey(API_OPERATIONS, operation))
    tags.api_operation = operation;
  // Drivers wrap failures (e.g. a Drizzle query wrapping a connection error).
  // Keep the deepest recognized code without exporting any cause text.
  let candidate: unknown = error;
  for (let depth = 0; depth < 5 && candidate instanceof Error; depth++) {
    // AWS service exceptions use Code/name and $metadata.httpStatusCode.
    const code = ["code", "Code", "name"]
      .map((key) => dataProperty(candidate, key))
      .find((value) => isVocabularyKey(API_ERROR_CODES, value));
    if (isVocabularyKey(API_ERROR_CODES, code)) tags.api_error_code = code;
    const status = [
      dataProperty(candidate, "status"),
      dataProperty(candidate, "statusCode"),
      dataProperty(dataProperty(candidate, "$metadata"), "httpStatusCode"),
    ].find(isErrorStatus);
    if (isErrorStatus(status)) tags.api_error_status = String(status);
    const name = dataProperty(candidate, "name");
    if (depth > 0 && typeof name === "string" && API_ERROR_TYPES.has(name))
      tags.api_cause_type = name;
    candidate = dataProperty(candidate, "cause");
  }
  return tags;
}

// Rechecked by both beforeSend and the transport; forged tags cannot bypass
// the allowlist, and API additions never apply to browser or desktop events.
export function sanitizeApiTags(tags: Event["tags"]): DiagnosticTags {
  const result: DiagnosticTags = {};
  const {
    api_operation: operation,
    diagnostic_source: source,
    api_error_code: code,
    api_error_status: status,
    api_cause_type: causeType,
    api_stack: stack,
  } = tags ?? {};
  result.api_operation = isVocabularyKey(API_OPERATIONS, operation)
    ? operation
    : source === "request-error"
      ? "http.request"
      : source === "websocket-error"
        ? "websocket.handshake"
        : "background";
  if (isVocabularyKey(API_ERROR_CODES, code)) result.api_error_code = code;
  if (typeof status === "string" && /^[45]\d{2}$/u.test(status))
    result.api_error_status = status;
  if (typeof causeType === "string" && API_ERROR_TYPES.has(causeType))
    result.api_cause_type = causeType;
  if (
    typeof stack === "string" &&
    ["original", "capture-site", "unavailable"].includes(stack)
  )
    result.api_stack = stack;
  return result;
}

export function apiErrorMessage(tags: DiagnosticTags): string {
  const operation = tags.api_operation;
  const code = tags.api_error_code;
  const label = isVocabularyKey(API_OPERATIONS, operation)
    ? API_OPERATIONS[operation]
    : "operation";
  const detail = isVocabularyKey(API_ERROR_CODES, code)
    ? `: ${API_ERROR_CODES[code]} (${code})`
    : "";
  const status = tags.api_error_status
    ? ` [HTTP ${tags.api_error_status}]`
    : "";
  return `API ${label} failed${detail}${status}`;
}
