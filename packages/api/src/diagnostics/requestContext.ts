import type { ApiRequestContext } from "@tearleads/diagnostics/server";
import type { Context } from "hono";
import { matchedRoutes } from "hono/route";

/** Registered templates only, never the URL or its parameter values. */
export function routeTemplate(c: Context): string {
  const route = matchedRoutes(c)[c.req.routeIndex];
  if (!route || (route.method === "ALL" && route.path === "/*"))
    return "unmatched";
  return route.path.replace(/:([^/]+)/g, "{$1}");
}

export function apiRequestContext(
  c: Context,
  status: number,
): ApiRequestContext {
  return { route: routeTemplate(c), method: c.req.method, status };
}
