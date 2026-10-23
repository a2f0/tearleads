import type { Event } from "@sentry/core";

export interface ApiRequestContext {
  readonly route: string;
  readonly method: string;
  readonly status: number;
}

const METHODS = new Set([
  "GET",
  "HEAD",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
  "CONNECT",
  "TRACE",
]);

type RequestTags = Partial<
  Record<"api_route" | "api_method" | "api_response_status", string>
>;

export function sanitizeApiRequestTags(
  tags: Event["tags"],
  routes?: ReadonlySet<string>,
): RequestTags {
  const result: RequestTags = {};
  const {
    api_route: route,
    api_method: method,
    api_response_status: status,
  } = tags ?? {};
  if (typeof route === "string" && routes?.has(route)) result.api_route = route;
  if (typeof method === "string" && METHODS.has(method))
    result.api_method = method;
  if (typeof status === "string" && /^[45]\d{2}$/u.test(status))
    result.api_response_status = status;
  return result;
}
