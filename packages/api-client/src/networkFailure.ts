import type { ApiReachability } from "./apiReachabilityProbe";

/**
 * What the client can honestly tell about a request that never got a
 * response. Browsers hide the network error code (`ERR_NAME_NOT_RESOLVED`,
 * `ERR_BLOCKED_BY_CLIENT`, a TLS failure and a CORS rejection all surface as
 * the same `TypeError`), so the classes are coarse on purpose:
 *
 * - `offline`: the device reports no network (`navigator.onLine === false`).
 * - `api-unreachable`: a follow-up `no-cors` probe of the API origin failed
 *   too: DNS, TLS, connection, or an extension/shield blocking the host.
 * - `cors-or-blocked`: the probe reached the API origin, so the host answers;
 *   this call was refused by CORS or its preflight, blocked by an extension
 *   rule narrower than the host, or its connection dropped.
 * - `timeout`/`aborted`: the caller's signal (or the runtime) ended it.
 * - `unclassified`: no probe ran (the host did not enable probing).
 */
export type ApiNetworkFailureClass =
  | "offline"
  | "api-unreachable"
  | "cors-or-blocked"
  | "timeout"
  | "aborted"
  | "unclassified";

/**
 * Structured, secret-free facts about one failed attempt. It never holds
 * headers, tokens, bodies, or the concrete path: only the operation's path
 * template, origins, and the runtime's error name and (URL-redacted) message.
 */
export interface ApiNetworkFailureDetails {
  readonly classification: ApiNetworkFailureClass;
  readonly hint: string;
  readonly method: string;
  readonly pathTemplate: string;
  readonly apiOrigin: string | null;
  readonly pageOrigin: string | null;
  readonly crossOrigin: boolean | null;
  /** True when a cross-origin browser call needs a CORS preflight. */
  readonly preflight: boolean;
  readonly attempt: number;
  readonly elapsedMs: number;
  readonly online: boolean | null;
  readonly errorName: string;
  readonly errorMessage: string;
  readonly causeName: string | null;
  readonly causeMessage: string | null;
  readonly probe: ApiReachability | "not-run";
}

/** A request that failed before any response arrived; see {@link ApiNetworkFailureClass}. */
export class ApiNetworkError extends Error {
  override readonly name = "ApiNetworkError";

  constructor(readonly details: ApiNetworkFailureDetails) {
    super(
      `${details.method} ${details.pathTemplate}: ${details.errorMessage} (${details.classification}: ${details.hint})`,
    );
  }
}

const SIMPLE_METHODS = new Set(["GET", "HEAD", "POST"]);
const SIMPLE_CONTENT_TYPES = new Set([
  "application/x-www-form-urlencoded",
  "multipart/form-data",
  "text/plain",
]);
// Fetch's CORS-unsafe request-header bytes, plus the value rules per header.
const UNSAFE_PUNCTUATION = new Set('"():<>?@[\\]{}');
function hasUnsafeByte(value: string): boolean {
  for (const char of value) {
    const code = char.charCodeAt(0);
    if ((code < 0x20 && code !== 0x09) || code === 0x7f) return true;
    if (UNSAFE_PUNCTUATION.has(char)) return true;
  }
  return false;
}
const SAFELISTED_HEADER_VALUE: Readonly<
  Record<string, (value: string) => boolean>
> = {
  accept: (value) => !hasUnsafeByte(value),
  "accept-language": (value) => /^[0-9A-Za-z *,\-.;=]*$/u.test(value),
  "content-language": (value) => /^[0-9A-Za-z *,\-.;=]*$/u.test(value),
  "content-type": (value) =>
    !hasUnsafeByte(value) &&
    SIMPLE_CONTENT_TYPES.has(value.split(";")[0]?.trim().toLowerCase() ?? ""),
  range: (value) => /^bytes=\d+-\d*$/u.test(value),
};
const MAX_MESSAGE_LENGTH = 200;

/**
 * Whether the Fetch spec sends a CORS preflight for this method and these
 * headers: a non-simple method, a header outside the safelist, a safelisted
 * value over 128 bytes or of the wrong form, or safelisted values over 1024.
 */
export function needsCorsPreflight(
  method: string,
  headers: Readonly<Record<string, string>>,
): boolean {
  if (!SIMPLE_METHODS.has(method.toUpperCase())) return true;
  const entries = Object.entries(headers);
  const total = entries.reduce((sum, [, value]) => sum + value.length, 0);
  return (
    total > 1024 ||
    entries.some(([name, value]) => {
      const valid = SAFELISTED_HEADER_VALUE[name.toLowerCase()];
      return !valid || value.length > 128 || !valid(value);
    })
  );
}

/**
 * Keeps origin and path of any URL in a runtime message; drops query and
 * fragment. A URL runs to the next whitespace, so no query punctuation (a
 * quote, a parenthesis) can end it early and leave a value behind; trailing
 * punctuation then lands in the kept path, percent-encoded.
 */
export function redactUrls(text: string): string {
  const redacted = text.replace(/\b(?:https?|wss?):\/\/\S+/giu, (raw) => {
    try {
      const url = new URL(raw);
      return `${url.origin}${url.pathname}`;
    } catch {
      return "[url]";
    }
  });
  return redacted.length > MAX_MESSAGE_LENGTH
    ? `${redacted.slice(0, MAX_MESSAGE_LENGTH)}...`
    : redacted;
}

function errorField(error: unknown, key: "name" | "message"): string | null {
  if (typeof error !== "object" || error === null || !(key in error)) {
    return null;
  }
  const value: unknown = Reflect.get(error, key);
  return typeof value === "string" ? value : null;
}

/** The origin `href` resolves to against `base`; null when it cannot resolve. */
function originOf(href: string | undefined, base?: string): string | null {
  if (!href) return null;
  try {
    const origin = new URL(href, base).origin;
    return origin === "null" ? null : origin;
  } catch {
    return null;
  }
}

function readOnline(): boolean | null {
  const online: unknown = globalThis.navigator?.onLine;
  return typeof online === "boolean" ? online : null;
}

function abortedClass(
  error: unknown,
  signal: AbortSignal | undefined,
): "timeout" | "aborted" | null {
  if (signal?.aborted) {
    return errorField(signal.reason, "name") === "TimeoutError"
      ? "timeout"
      : "aborted";
  }
  const name = errorField(error, "name");
  if (name === "TimeoutError") return "timeout";
  return name === "AbortError" ? "aborted" : null;
}

function hintFor(
  classification: ApiNetworkFailureClass,
  apiOrigin: string | null,
  crossOrigin: boolean | null,
): string {
  const openApi = apiOrigin ? `; open ${apiOrigin}/ in a tab` : "";
  switch (classification) {
    case "offline":
      return "this device reports no network connection";
    case "api-unreachable":
      return `API host unreachable from this browser: check DNS, extensions/shields, or network${openApi}`;
    case "cors-or-blocked":
      return crossOrigin
        ? "API host is reachable but this call failed: a CORS/preflight rejection, a blocking extension rule, or a dropped connection; check the browser console"
        : "API host is reachable but this call failed: a blocking extension rule or a dropped connection; check the browser console";
    case "timeout":
      return "the request timed out before the API answered";
    case "aborted":
      return "the request was aborted before the API answered";
    case "unclassified":
      return `the request failed before the API answered${openApi}`;
  }
}

/**
 * The runtime's own message, followed by the classification and its hint once
 * there is one; a plain cancellation or an unprobed failure keeps the message.
 */
export function networkFailureMessage(
  error: unknown,
  networkError: ApiNetworkError,
): string {
  const message =
    errorField(error, "message") ?? (error === undefined ? "" : String(error));
  const { classification, hint } = networkError.details;
  return classification === "unclassified" || classification === "aborted"
    ? message
    : `${message} (${classification}: ${hint})`;
}

export interface NetworkFailureInput {
  readonly attempt: number;
  readonly baseUrl: string;
  readonly elapsedMs: number;
  readonly error: unknown;
  readonly headers: Readonly<Record<string, string>>;
  readonly method: string;
  readonly pathTemplate: string;
  readonly probe?:
    | ((apiOrigin: string) => Promise<ApiReachability>)
    | null
    | undefined;
  readonly signal?: AbortSignal | undefined;
  /** The host's connectivity reading, taken before this failure was reported; null defers to `navigator.onLine`. */
  readonly online?: boolean | null | undefined;
}

/** A host reading that throws must not turn a failure into a rejection. */
function readHostOnline(
  isOnline: (() => boolean | null) | undefined,
): boolean | null {
  try {
    return isOnline?.() ?? null;
  } catch {
    return null;
  }
}

/** The probe's answer, or null once the caller's signal aborts first. */
async function probeUnlessAborted(
  probe: (apiOrigin: string) => Promise<ApiReachability>,
  apiOrigin: string,
  signal: AbortSignal | undefined,
): Promise<ApiReachability | null> {
  // `then` also turns a probe that throws synchronously into "unreachable".
  const answer = Promise.resolve(apiOrigin)
    .then(probe)
    .catch(() => "unreachable" as const);
  if (!signal) return answer;
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<null>((resolve) => {
    onAbort = () => resolve(null);
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([answer, aborted]);
  } finally {
    if (onAbort) signal.removeEventListener("abort", onAbort);
  }
}

async function classify(
  input: NetworkFailureInput,
  apiOrigin: string | null,
  crossOrigin: boolean | null,
  online: boolean | null,
): Promise<{
  readonly classification: ApiNetworkFailureClass;
  readonly probe: ApiReachability | "not-run";
}> {
  const early =
    abortedClass(input.error, input.signal) ??
    (online === false ? "offline" : null);
  // A same-origin probe could be answered by the page's service worker cache,
  // so it would not show the API host is reachable.
  if (early || !input.probe || !apiOrigin || crossOrigin === false) {
    return { classification: early ?? "unclassified", probe: "not-run" };
  }
  const probe = await probeUnlessAborted(input.probe, apiOrigin, input.signal);
  // The caller may cancel while the probe runs; that ends the request.
  const abortedLater = abortedClass(undefined, input.signal);
  if (abortedLater || probe === null) {
    return { classification: abortedLater ?? "aborted", probe: "not-run" };
  }
  return {
    classification:
      probe === "reachable" ? "cors-or-blocked" : "api-unreachable",
    probe,
  };
}

/**
 * Handles a thrown fetch in order: read the host's connectivity before the
 * reachability hint can flip a non-authoritative source, send that hint
 * unless the caller already cancelled, classify, and say whether the caller
 * cancelled meanwhile (then the request ends as a cancellation).
 */
export async function settleNetworkFailure(
  input: Omit<NetworkFailureInput, "online"> & {
    readonly isOnline?: (() => boolean | null) | undefined;
    readonly onNetworkError: () => void;
  },
): Promise<{
  readonly cancelled: boolean;
  readonly networkError: ApiNetworkError;
}> {
  const online = readHostOnline(input.isOnline);
  const cancelledAtFailure = input.signal?.aborted === true;
  if (!cancelledAtFailure) input.onNetworkError();
  const networkError = await describeNetworkFailure({
    ...input,
    online,
    probe: cancelledAtFailure ? null : input.probe,
  });
  return { cancelled: input.signal?.aborted === true, networkError };
}

/**
 * Builds the typed error for a thrown fetch. A probe runs only for failures
 * that are neither aborted nor offline, only for a cross-origin API, and only
 * when the host supplied one; a caller abort ends the wait for it.
 */
async function describeNetworkFailure(
  input: NetworkFailureInput,
): Promise<ApiNetworkError> {
  const pageHref: string | undefined = globalThis.location?.href;
  const pageOrigin = originOf(pageHref);
  const apiOrigin = originOf(input.baseUrl || pageHref, pageHref);
  const crossOrigin = pageOrigin && apiOrigin ? pageOrigin !== apiOrigin : null;
  const online = input.online ?? readOnline();
  const { classification, probe } = await classify(
    input,
    apiOrigin,
    crossOrigin,
    online,
  );
  const cause: unknown =
    typeof input.error === "object" && input.error !== null
      ? Reflect.get(input.error, "cause")
      : undefined;
  const causeMessage = errorField(cause, "message");
  return new ApiNetworkError({
    classification,
    hint: hintFor(classification, apiOrigin, crossOrigin),
    method: input.method,
    pathTemplate: input.pathTemplate,
    apiOrigin,
    pageOrigin,
    crossOrigin,
    preflight:
      crossOrigin === true && needsCorsPreflight(input.method, input.headers),
    attempt: input.attempt,
    elapsedMs: Math.max(0, Math.round(input.elapsedMs)),
    online,
    errorName: errorField(input.error, "name") ?? typeof input.error,
    errorMessage: redactUrls(
      errorField(input.error, "message") ?? String(input.error),
    ),
    causeName: errorField(cause, "name"),
    causeMessage: causeMessage === null ? null : redactUrls(causeMessage),
    probe,
  });
}
