import { withDatabaseStatementCounter } from "@tearleads/api-shared/postgres";
import type { MiddlewareHandler } from "hono";
import { routeTemplate } from "./requestContext";

export const serverTimingHeaderName = "Server-Timing";
const REQUEST_COST_EVENT = "api.request.cost";

/** Deployed Workers set this; tests and local servers stay quiet. */
export function readApiRequestCostLog(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const { API_REQUEST_COST_LOG: enabled } = env;
  return enabled?.trim() === "true";
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
