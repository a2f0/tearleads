import { apiVersionHeaderName } from "@tearleads/validators/operation";
import type { MiddlewareHandler } from "hono";

// Replaced by the executable builder with HEAD's commit count, or null when the
// build could not count it. Absent when the API runs from source.
declare const API_BUILD_VERSION: number | null;

export function readApiBuildVersion(): number | null {
  return typeof API_BUILD_VERSION === "undefined" ? null : API_BUILD_VERSION;
}

/**
 * Stamp every response with the serving build so clients can attribute their
 * own failures to it. Set after the handler so error and not-found responses
 * carry it too.
 */
export function createApiVersionMiddleware(version: number): MiddlewareHandler {
  const value = String(version);
  return async (c, next) => {
    await next();
    c.header(apiVersionHeaderName, value);
  };
}
