import type {
  Breadcrumb,
  ErrorEvent,
  Event,
  StackFrame,
} from "@sentry/browser";
import { isDiagnosticAction, isDiagnosticArea } from "app/host/AppDiagnostics";

export interface SentryPrivacyConfig {
  origin: string;
  scriptPath: string;
  environment: "staging" | "production";
  release: string;
  dist: "staging-app" | "production-app";
}

const ERROR_TYPES = new Set([
  "Error",
  "TypeError",
  "RangeError",
  "ReferenceError",
  "SyntaxError",
  "URIError",
  "EvalError",
  "AggregateError",
]);
const SOURCES = new Set([
  "boundary",
  "log",
  "unhandled-error",
  "unhandled-rejection",
]);

function safeFrame(
  frame: StackFrame,
  config: SentryPrivacyConfig,
): StackFrame | null {
  if (typeof frame.filename !== "string") return null;
  let url: URL;
  try {
    url = new URL(frame.filename);
  } catch {
    return null;
  }
  // Only generated code assets qualify. Never send URLs containing route IDs,
  // query strings, fragments, function names, source context, or local variables.
  const filename =
    url.protocol === "app:"
      ? url.pathname
      : url.origin === config.origin
        ? url.pathname
        : "";
  if (filename !== config.scriptPath) return null;
  if (
    typeof frame.lineno !== "number" ||
    !Number.isSafeInteger(frame.lineno) ||
    frame.lineno < 1
  )
    return null;
  return {
    filename: `app://${filename}`,
    lineno: frame.lineno,
    ...(Number.isSafeInteger(frame.colno) && (frame.colno ?? -1) >= 0
      ? { colno: frame.colno }
      : {}),
    in_app: true,
  };
}

export function sanitizeBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb | null {
  const { area, action } = breadcrumb.data ?? {};
  if (
    breadcrumb.category !== "app.activity" ||
    !isDiagnosticArea(area) ||
    !isDiagnosticAction(action)
  )
    return null;
  return {
    category: "app.activity",
    level: "info",
    data: { area, action },
    ...(typeof breadcrumb.timestamp === "number" &&
    Number.isFinite(breadcrumb.timestamp)
      ? { timestamp: breadcrumb.timestamp }
      : {}),
  };
}

// Reconstruct from an allowlist, rather than trying to redact known secrets.
// Error messages are untrusted: they can contain decrypted user content.
export function sanitizeSentryEvent(
  event: Event,
  config: SentryPrivacyConfig,
): ErrorEvent | null {
  if (event.type !== undefined) return null;
  const { area, diagnostic_source: source } = event.tags ?? {};
  if (typeof source !== "string" || !SOURCES.has(source)) return null;
  const frames = (event.exception?.values?.[0]?.stacktrace?.frames ?? [])
    .map((frame) => safeFrame(frame, config))
    .filter((frame): frame is StackFrame => frame !== null)
    .slice(-40);
  // Includes anonymous Chrome DevTools and extension-only failures. An explicit
  // boundary still reports a generic failure if no usable stack is available.
  if (!frames.length && source !== "boundary") return null;
  const type = event.exception?.values?.[0]?.type ?? "Error";
  return {
    type: undefined,
    ...(typeof event.event_id === "string" &&
    /^[a-f0-9]{32}$/u.test(event.event_id)
      ? { event_id: event.event_id }
      : {}),
    timestamp:
      typeof event.timestamp === "number" && Number.isFinite(event.timestamp)
        ? event.timestamp
        : Date.now() / 1000,
    platform: "javascript",
    level: "error",
    environment: config.environment,
    release: config.release,
    dist: config.dist,
    // Prevent Sentry's event ingestion from inferring the sender's IP as a user.
    user: { ip_address: "0.0.0.0" },
    tags: {
      area: isDiagnosticArea(area) ? area : "app",
      diagnostic_source: source,
      privacy: "allowlist-v1",
    },
    exception: {
      values: [
        {
          type: ERROR_TYPES.has(type) ? type : "Error",
          value: "Application error (message omitted)",
          ...(frames.length ? { stacktrace: { frames } } : {}),
          mechanism: {
            type: "generic",
            handled: source === "boundary" || source === "log",
          },
        },
      ],
    },
    breadcrumbs: (event.breadcrumbs ?? [])
      .map(sanitizeBreadcrumb)
      .filter((breadcrumb): breadcrumb is Breadcrumb => breadcrumb !== null)
      .slice(-30),
  };
}
