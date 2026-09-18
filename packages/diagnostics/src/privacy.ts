import type { Breadcrumb, ErrorEvent, Event, StackFrame } from "@sentry/core";
import { isDiagnosticAction, isDiagnosticArea } from "./activity";

export interface SentryPrivacyConfig {
  origin: string;
  scriptPath: string;
  environment: "staging" | "production";
  release: string;
  // Web and mobile report the tier's app dist and the API the bare tier. Each
  // Electrobun build target has its own app dist, because one commit's builds
  // serve different bundles at the same app:/// URLs.
  dist:
    | "staging-app"
    | "production-app"
    | "staging"
    | "production"
    | `${"staging" | "production"}-app-${"linux-arm64" | "linux-x64" | "macos-arm64" | "win-x64"}`;
  scriptPaths?: ReadonlySet<string>;
  serverSourceRoot?: string;
  runtime?: "api" | "electrobun-main";
  budgetResetMs?: number;
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
// Each server runtime admits only failures its host raises: the API installs no
// process-wide handlers; the Electrobun main process does.
const SERVER_SOURCES = {
  api: new Set(["background-error", "request-error", "websocket-error"]),
  "electrobun-main": new Set([
    "background-error",
    "request-error",
    "unhandled-error",
    "unhandled-rejection",
  ]),
};
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
  const serverRoot = config.serverSourceRoot;
  if (config.runtime && serverRoot) {
    const filename = serverFrameFilename(
      frame.filename,
      config.runtime,
      serverRoot,
    );
    return filename && config.scriptPaths?.has(filename)
      ? safePosition(frame, filename)
      : null;
  }
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
  if (!filename) return null;
  if (filename !== config.scriptPath && !config.scriptPaths?.has(filename))
    return null;
  return safePosition(frame, filename);
}

// The API's compiled executable also reports app:/// and repository-relative
// frames. The Electrobun launcher always runs an absolute bundle path, so any
// other spelling there is foreign code (for example an eval carrying a borrowed
// sourceURL).
function serverFrameFilename(
  filename: string,
  runtime: "api" | "electrobun-main",
  serverRoot: string,
): string {
  const windowsRoot = /^(?:[A-Za-z]:[\\/]|\\\\)/u.test(serverRoot);
  const root = windowsRoot ? serverRoot.replaceAll("\\", "/") : serverRoot;
  const path = windowsRoot ? filename.replaceAll("\\", "/") : filename;
  if (path.startsWith(`${root}/`)) return path.slice(root.length);
  if (runtime !== "api") return "";
  return filename.startsWith("app:///")
    ? filename.slice("app://".length)
    : `/${filename}`;
}

function safePosition(frame: StackFrame, filename: string): StackFrame | null {
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
  const sources = config.runtime ? SERVER_SOURCES[config.runtime] : SOURCES;
  if (typeof source !== "string" || !sources.has(source)) return null;
  const frames = (event.exception?.values?.[0]?.stacktrace?.frames ?? [])
    .map((frame) => safeFrame(frame, config))
    .filter((frame): frame is StackFrame => frame !== null)
    .slice(-40);
  // Includes anonymous Chrome DevTools and extension-only failures. An explicit
  // boundary still reports a generic failure if no usable stack is available.
  if (!frames.length && source !== "boundary" && !config.runtime) return null;
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
      area: config.runtime ?? (isDiagnosticArea(area) ? area : "app"),
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
            handled: [
              "background-error",
              "boundary",
              "log",
              "request-error",
              "websocket-error",
            ].includes(source),
          },
        },
      ],
    },
    breadcrumbs: (config.runtime ? [] : (event.breadcrumbs ?? []))
      .map(sanitizeBreadcrumb)
      .filter((breadcrumb): breadcrumb is Breadcrumb => breadcrumb !== null)
      .slice(-30),
  };
}
