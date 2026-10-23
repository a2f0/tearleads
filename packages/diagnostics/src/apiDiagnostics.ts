import type { Event } from "@sentry/core";
import {
  API_ERROR_CODES,
  API_ERROR_TYPES,
  API_OPERATIONS,
  type ApiDiagnosticOperation,
  isVocabularyKey,
} from "./apiVocabulary";
import {
  errorDataProperty as dataProperty,
  diagnosticErrorChain,
} from "./errorProperties";

type DiagnosticTags = Partial<
  Record<
    | "api_operation"
    | "api_error_code"
    | "api_error_status"
    | "api_cause_type"
    | "api_stack"
    | "api_database_stage"
    | "api_connection_attempts"
    | "api_pool_total"
    | "api_pool_idle"
    | "api_pool_waiting",
    string
  >
>;

const POOL_COUNTERS = {
  connectionAttempts: "api_connection_attempts",
  poolTotal: "api_pool_total",
  poolIdle: "api_pool_idle",
  poolWaiting: "api_pool_waiting",
} as const;

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
  for (const [depth, candidate] of diagnosticErrorChain(error).entries()) {
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
    if (dataProperty(candidate, "databaseStage") === "connect") {
      tags.api_database_stage = "connect";
      for (const [property, tag] of Object.entries(POOL_COUNTERS)) {
        const value = dataProperty(candidate, property);
        if (
          Number.isSafeInteger(value) &&
          Number(value) >= 0 &&
          Number(value) <= 10000
        )
          tags[tag] = String(value);
      }
    }
  }
  return tags;
}

// Rechecked by both beforeSend and the transport; forged tags cannot bypass
// the allowlist, and API additions never apply to browser or desktop events.
export function sanitizeApiTags(tags: Event["tags"]): DiagnosticTags {
  const result = sanitizePoolTags(tags);
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

function sanitizePoolTags(tags: Event["tags"]): DiagnosticTags {
  const result: DiagnosticTags = {};
  const { api_database_stage: stage } = tags ?? {};
  if (stage === "connect") {
    result.api_database_stage = "connect";
    for (const tag of Object.values(POOL_COUNTERS)) {
      const value = tags?.[tag];
      if (
        typeof value === "string" &&
        /^(?:0|[1-9]\d{0,3}|10000)$/u.test(value)
      )
        result[tag] = value;
    }
  }
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
