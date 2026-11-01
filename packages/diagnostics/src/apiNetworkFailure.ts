import type { Breadcrumb, Event } from "@sentry/core";

/**
 * The facts api-client's `ApiNetworkError` carries about a request that got no
 * response, typed structurally so diagnostics imports no client code. Only the
 * coarse values {@link apiNetworkFailureTags} derives from it may leave the
 * device; the hint, raw messages, cause message, and origins never do.
 */
export interface ApiNetworkFailureInput {
  readonly classification: string;
  readonly method: string;
  readonly pathTemplate: string;
  readonly apiOrigin: string | null;
  readonly pageOrigin: string | null;
  readonly crossOrigin: boolean | null;
  readonly preflight: boolean;
  readonly attempt: number;
  readonly elapsedMs: number;
  readonly online: boolean | null;
  readonly errorName: string;
  readonly errorMessage: string;
  readonly causeName: string | null;
  readonly probe: string;
}

// `aborted` is a cancellation, not a failure, and is never reported.
const CLASSES = new Set([
  "offline",
  "api-unreachable",
  "cors-or-blocked",
  "timeout",
  "unclassified",
]);
const METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"]);
const ERROR_NAMES = new Set([
  "Error",
  "TypeError",
  "AbortError",
  "TimeoutError",
  "NetworkError",
  "SecurityError",
]);
// Fixed runtime phrasings (Chromium, Firefox, WebKit). A message is reduced to
// one of these labels by its prefix; nothing after the prefix is kept.
const MESSAGES: ReadonlyArray<readonly [string, string]> = [
  ["Failed to fetch", "failed-to-fetch"],
  ["NetworkError when attempting to fetch resource", "network-error"],
  ["Load failed", "load-failed"],
  ["The network connection was lost", "connection-lost"],
  ["The Internet connection appears to be offline", "internet-offline"],
  ["The request timed out", "request-timed-out"],
  ["Could not connect to the server", "could-not-connect"],
  [
    "A server with the specified hostname could not be found",
    "hostname-not-found",
  ],
  ["signal timed out", "signal-timed-out"],
];
const ELAPSED: ReadonlyArray<readonly [number, string]> = [
  [100, "lt-100ms"],
  [1_000, "lt-1s"],
  [3_000, "lt-3s"],
  [10_000, "lt-10s"],
  [30_000, "lt-30s"],
];
const TAG_VALUES = {
  api_network_class: CLASSES,
  api_network_method: new Set([...METHODS, "other"]),
  api_network_attempt: new Set(["1", "2", "other"]),
  api_network_elapsed: new Set([...ELAPSED.map(([, b]) => b), "gte-30s"]),
  api_network_online: new Set(["online", "offline", "unknown"]),
  api_network_cross_origin: new Set(["true", "false", "unknown"]),
  api_network_preflight: new Set(["true", "false"]),
  api_network_api_origin: new Set(["default", "custom", "unknown"]),
  api_network_page_origin: new Set(["default", "custom", "unknown"]),
  api_network_probe: new Set(["reachable", "unreachable", "not-run"]),
  api_network_error: new Set([...ERROR_NAMES, "other"]),
  api_network_cause: new Set([...ERROR_NAMES, "other", "none"]),
  api_network_message: new Set([...MESSAGES.map(([, l]) => l), "other"]),
} satisfies Record<string, ReadonlySet<string>>;

export type ApiNetworkTagName = keyof typeof TAG_VALUES | "api_network_route";
export type ApiNetworkTags = Readonly<Record<ApiNetworkTagName, string>>;
const TAG_NAMES: readonly ApiNetworkTagName[] = [
  "api_network_class",
  "api_network_method",
  "api_network_route",
  "api_network_attempt",
  "api_network_elapsed",
  "api_network_online",
  "api_network_cross_origin",
  "api_network_preflight",
  "api_network_api_origin",
  "api_network_page_origin",
  "api_network_probe",
  "api_network_error",
  "api_network_cause",
  "api_network_message",
];
const BREADCRUMB_FIELDS: readonly ApiNetworkTagName[] = [
  "api_network_class",
  "api_network_method",
  "api_network_route",
  "api_network_attempt",
  "api_network_elapsed",
  "api_network_online",
];

/**
 * Only an exact registered operation path template passes; anything else,
 * including a concrete path or one built to look like a template, is `other`.
 * Without a registry nothing passes.
 */
function isRouteTemplate(
  value: string,
  routes: ReadonlySet<string> | undefined,
): boolean {
  return routes?.has(value) === true;
}

// First-party API hosts are fixed public names; any other host (self-hosted,
// custom, or local) is reported only as `custom`.
function apiOriginLabel(origin: string | null): string {
  if (origin === null) return "unknown";
  try {
    const url = new URL(origin);
    return url.protocol === "https:" &&
      !url.port &&
      (url.hostname === "tearleads.com" ||
        url.hostname.endsWith(".tearleads.com"))
      ? "default"
      : "custom";
  } catch {
    return "custom";
  }
}

function tri(value: boolean | null, yes: string, no: string): string {
  return value === null ? "unknown" : value ? yes : no;
}

function errorNameLabel(name: string | null): string {
  if (name === null) return "none";
  return ERROR_NAMES.has(name) ? name : "other";
}

function messageLabel(message: string): string {
  const trimmed = message.trim();
  return (
    MESSAGES.find(([prefix]) => trimmed.startsWith(prefix))?.[1] ?? "other"
  );
}

function elapsedLabel(ms: number): string {
  return ELAPSED.find(([limit]) => ms < limit)?.[1] ?? "gte-30s";
}

/**
 * The reviewed, coarse tags for one failure, or null when it is not reported
 * (a cancellation or an unknown class). `pageOrigin` is the app's own origin
 * and `routes` the registered operation path templates.
 */
export function apiNetworkFailureTags(
  failure: ApiNetworkFailureInput,
  pageOrigin: string,
  routes: ReadonlySet<string> | undefined,
): ApiNetworkTags | null {
  if (!CLASSES.has(failure.classification)) return null;
  const method = failure.method.toUpperCase();
  return {
    api_network_class: failure.classification,
    api_network_method: METHODS.has(method) ? method : "other",
    api_network_route: isRouteTemplate(failure.pathTemplate, routes)
      ? failure.pathTemplate
      : "other",
    api_network_attempt:
      failure.attempt === 1 || failure.attempt === 2
        ? String(failure.attempt)
        : "other",
    api_network_elapsed: elapsedLabel(failure.elapsedMs),
    api_network_online: tri(failure.online, "online", "offline"),
    api_network_cross_origin: tri(failure.crossOrigin, "true", "false"),
    api_network_preflight: String(failure.preflight === true),
    api_network_api_origin: apiOriginLabel(failure.apiOrigin),
    api_network_page_origin:
      failure.pageOrigin === null
        ? "unknown"
        : failure.pageOrigin === pageOrigin
          ? "default"
          : "custom",
    api_network_probe: TAG_VALUES.api_network_probe.has(failure.probe)
      ? failure.probe
      : "not-run",
    api_network_error: errorNameLabel(failure.errorName),
    api_network_cause: errorNameLabel(failure.causeName),
    api_network_message: messageLabel(failure.errorMessage),
  };
}

function isAllowedTag(
  name: ApiNetworkTagName,
  value: string,
  routes: ReadonlySet<string> | undefined,
): boolean {
  if (name === "api_network_route")
    return value === "other" || isRouteTemplate(value, routes);
  return TAG_VALUES[name].has(value);
}

/**
 * Re-validates network tags at the event boundary: every tag must hold a
 * reviewed value, or the whole set is dropped (and with it the event).
 */
export function sanitizeApiNetworkTags(
  tags: Event["tags"] | Breadcrumb["data"],
  routes: ReadonlySet<string> | undefined,
  names: readonly ApiNetworkTagName[] = TAG_NAMES,
): Partial<ApiNetworkTags> | null {
  const result: Partial<Record<ApiNetworkTagName, string>> = {};
  for (const name of names) {
    const value: unknown = tags?.[name];
    if (typeof value !== "string" || !isAllowedTag(name, value, routes))
      return null;
    result[name] = value;
  }
  return result;
}

/** The fixed event message for a class; never derived from runtime text. */
export function apiNetworkFailureMessage(classification: string): string {
  return `API request failed without a response (${classification})`;
}

function apiNetworkBreadcrumbData(
  tags: Partial<ApiNetworkTags>,
): Record<string, string> {
  return Object.fromEntries(
    BREADCRUMB_FIELDS.map((name) => [name, tags[name] ?? "other"]),
  );
}

/** The reviewed `api.network` breadcrumb, or null for anything else. */
export function sanitizeApiNetworkBreadcrumb(
  breadcrumb: Breadcrumb,
  routes: ReadonlySet<string> | undefined,
): Breadcrumb | null {
  if (breadcrumb.category !== "api.network") return null;
  const data = sanitizeApiNetworkTags(
    breadcrumb.data,
    routes,
    BREADCRUMB_FIELDS,
  );
  if (!data) return null;
  return {
    category: "api.network",
    level: "warning",
    data: apiNetworkBreadcrumbData(data),
    ...(typeof breadcrumb.timestamp === "number" &&
    Number.isFinite(breadcrumb.timestamp)
      ? { timestamp: breadcrumb.timestamp }
      : {}),
  };
}

export interface ApiNetworkFailureSink {
  readonly captureEvent: (tags: ApiNetworkTags) => void;
  readonly addBreadcrumb: (data: Record<string, string>) => void;
}

const BREADCRUMB_WINDOW_MS = 60_000;
// A third of the 30-crumb trail, so activity crumbs survive any burst.
const BREADCRUMBS_PER_WINDOW = 10;

/** Admits at most `limit` breadcrumbs per window, whatever their keys. */
function createWindowLimit(limit: number, now: () => number) {
  let windowStart = Number.NEGATIVE_INFINITY;
  let count = 0;
  return (): boolean => {
    const at = now();
    if (at - windowStart >= BREADCRUMB_WINDOW_MS) {
      windowStart = at;
      count = 0;
    }
    if (count >= limit) return false;
    count++;
    return true;
  };
}

/**
 * Rate limits network reports for one page load: the first failure of each
 * class becomes an event, later ones breadcrumbs. A breadcrumb repeating the
 * same class, method, and route within a minute is dropped, and at most ten
 * network breadcrumbs a minute are kept across all routes, so a dead network
 * neither floods the project nor flushes the activity trail.
 */
export function createApiNetworkFailureReporter(
  sink: ApiNetworkFailureSink,
  pageOrigin: string,
  routes: () => ReadonlySet<string> | undefined,
  now: () => number = Date.now,
) {
  const reportedClasses = new Set<string>();
  const lastBreadcrumbAt = new Map<string, number>();
  const admitBreadcrumb = createWindowLimit(BREADCRUMBS_PER_WINDOW, now);
  return (failure: ApiNetworkFailureInput): void => {
    const tags = apiNetworkFailureTags(failure, pageOrigin, routes());
    if (!tags) return;
    if (!reportedClasses.has(tags.api_network_class)) {
      reportedClasses.add(tags.api_network_class);
      sink.captureEvent(tags);
      return;
    }
    const key = JSON.stringify([
      tags.api_network_class,
      tags.api_network_method,
      tags.api_network_route,
    ]);
    const at = now();
    const last = lastBreadcrumbAt.get(key);
    if (last !== undefined && at - last < BREADCRUMB_WINDOW_MS) return;
    if (!admitBreadcrumb()) return;
    // Bounded: at most 5 classes x 7 methods x the registered route templates.
    lastBreadcrumbAt.set(key, at);
    sink.addBreadcrumb(apiNetworkBreadcrumbData(tags));
  };
}
