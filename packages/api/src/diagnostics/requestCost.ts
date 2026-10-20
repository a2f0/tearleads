import { withDatabaseStatementCounter } from "@tearleads/api-shared/postgres";
import type { Context, MiddlewareHandler } from "hono";
import { matchedRoutes } from "hono/route";

export const serverTimingHeaderName = "Server-Timing";
const REQUEST_COST_EVENT = "api.request.cost";
const UNMATCHED_ROUTE = "unmatched";
const ROUTE_PARAMETER_PATTERN = /:([^/]+)/g;

/** Deployed Workers set this; tests and local servers stay quiet. */
export function readApiRequestCostLog(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const { API_REQUEST_COST_LOG: enabled } = env;
  return enabled?.trim() === "true";
}

/**
 * The route that answered, written as its operation path template
 * (`/documents/{documentId}`), so a log line never carries the request URL or
 * the IDs inside it. A request no route matched was answered after the global
 * `*` middleware, which names nothing.
 */
function routeTemplate(c: Context): string {
  const route = matchedRoutes(c)[c.req.routeIndex];
  if (!route || (route.method === "ALL" && route.path === "/*")) {
    return UNMATCHED_ROUTE;
  }
  return route.path.replace(ROUTE_PARAMETER_PATTERN, "{$1}");
}

function roundMilliseconds(milliseconds: number): number {
  return Math.round(milliseconds * 10) / 10;
}

/**
 * Time each request and the database work it issues, report both in a
 * `Server-Timing` header, and, when enabled, log one JSON line per request for
 * Workers Logs. The header carries durations only: a statement count on a
 * refusal could tell a client whether a resource it cannot read exists.
 *
 * On Workers the clock advances only across I/O, so both durations measure
 * I/O waits (database, fetches, Durable Objects) until the handler returns;
 * CPU-bound work reads as zero and appears as the invocation's CPU time.
 * `db` sums driver calls, so concurrent queries can make it exceed `total`.
 */
export function createRequestCostMiddleware(options: {
  readonly log: boolean;
}): MiddlewareHandler {
  return async (c, next) => {
    const counter = { statements: 0, waitMs: 0 };
    const startedAt = performance.now();
    await withDatabaseStatementCounter(counter, next);
    const wallMs = roundMilliseconds(performance.now() - startedAt);
    const dbMs = roundMilliseconds(counter.waitMs);
    c.header(serverTimingHeaderName, `total;dur=${wallMs}, db;dur=${dbMs}`);
    if (options.log) {
      console.log(
        JSON.stringify({
          event: REQUEST_COST_EVENT,
          method: c.req.method,
          route: routeTemplate(c),
          status: c.res.status,
          statements: counter.statements,
          wallMs,
          dbMs,
        }),
      );
    }
  };
}
