import type { Context } from "hono";

/**
 * Per-request bindings the composition root passes to `routeApp.fetch`. Tests
 * that call `fetch` without bindings leave `c.env` undefined, so readers must
 * tolerate its absence.
 */
export interface RouteRequestBindings {
  readonly directClientIp?: string | null | undefined;
}

/** The slice of a Hono context the request-IP reader needs. */
type RequestIpSource = Pick<
  Context<{ Bindings: RouteRequestBindings }>,
  "env" | "req"
>;

/**
 * Client IP resolution shared by session issuance, registration, and the
 * session activity tracker: proxy headers first, then the direct socket
 * address the composition root binds per request.
 */
export function normalizeRequestIpAddress(
  value: string | null | undefined,
): string | null {
  let normalized = value?.trim();
  if (!normalized) {
    return null;
  }

  if (normalized.startsWith('"') && normalized.endsWith('"')) {
    normalized = normalized.slice(1, -1).trim();
  }
  if (normalized.startsWith("[") && normalized.includes("]")) {
    normalized = normalized.slice(1, normalized.indexOf("]"));
  }
  if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/u.test(normalized)) {
    normalized = normalized.slice(0, normalized.lastIndexOf(":"));
  }

  if (normalized.length === 0 || normalized.length > 128) {
    return null;
  }
  if (normalized.toLowerCase() === "unknown") {
    return null;
  }

  return normalized;
}

function firstHeaderIpAddress(value: string | null | undefined): string | null {
  for (const candidate of value?.split(",") ?? []) {
    const ipAddress = normalizeRequestIpAddress(candidate);
    if (ipAddress) {
      return ipAddress;
    }
  }

  return null;
}

function forwardedHeaderIpAddress(
  value: string | null | undefined,
): string | null {
  for (const entry of value?.split(",") ?? []) {
    const forPart = entry
      .split(";")
      .find((part) => part.trim().toLowerCase().startsWith("for="));
    if (!forPart) {
      continue;
    }

    const ipAddress = normalizeRequestIpAddress(
      forPart.slice(forPart.indexOf("=") + 1),
    );
    if (ipAddress) {
      return ipAddress;
    }
  }

  return null;
}

export function readRequestIpAddress(c: RequestIpSource): string | null {
  return (
    normalizeRequestIpAddress(c.req.header("cf-connecting-ip")) ??
    normalizeRequestIpAddress(c.req.header("x-real-ip")) ??
    firstHeaderIpAddress(c.req.header("x-forwarded-for")) ??
    forwardedHeaderIpAddress(c.req.header("forwarded")) ??
    normalizeRequestIpAddress(c.env?.directClientIp)
  );
}
