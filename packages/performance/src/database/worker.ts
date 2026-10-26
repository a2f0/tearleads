import { timingSafeEqual } from "node:crypto";
import {
  createPostgresPoolConfig,
  PostgresPool,
  readPostgresStreamConfig,
} from "@tearleads/api-shared/postgres-transport";
import { measureDatabase, type ProbePool } from "./probe";

interface ProbeBindings {
  HYPERDRIVE: { connectionString: string };
  PROBE_TOKEN: string;
  PROBE_RUN: string;
  PROBE_EXPIRES: string;
  POSTGRES_COALESCE_WRITES: string;
  POSTGRES_POOL_MAX: string;
  POSTGRES_POOL_MAX_USES: string;
}

function createPool(bindings: ProbeBindings): ProbePool {
  const env = {
    POSTGRES_COALESCE_WRITES: bindings.POSTGRES_COALESCE_WRITES,
    POSTGRES_POOL_MAX: bindings.POSTGRES_POOL_MAX,
    POSTGRES_POOL_MAX_USES: bindings.POSTGRES_POOL_MAX_USES,
    DATABASE_URL: bindings.HYPERDRIVE.connectionString,
    POSTGRES_SSL: "false",
  };
  const pool = new PostgresPool(
    Object.assign(
      createPostgresPoolConfig(env, { requestScoped: true }),
      readPostgresStreamConfig(env),
      { query_timeout: 5_000 },
    ),
  );
  // A failed query is reported as a bounded error, never a driver message that
  // may contain connection details. end() still runs in measureDatabase.
  pool.on("error", () => {});
  return pool;
}

function authorized(request: Request, env: ProbeBindings): boolean {
  if (!/^[a-f0-9]{64}$/.test(env.PROBE_TOKEN)) return false;
  const expected = Buffer.from(`Bearer ${env.PROBE_TOKEN}`);
  const supplied = Buffer.from(request.headers.get("authorization") ?? "");
  return (
    supplied.length === expected.length && timingSafeEqual(expected, supplied)
  );
}

export function createProbeHandler(pool = createPool) {
  return async (request: Request, env: ProbeBindings): Promise<Response> => {
    const expires = Number(env.PROBE_EXPIRES);
    if (!authorized(request, env)) return new Response(null, { status: 401 });
    if (!Number.isFinite(expires) || Date.now() >= expires)
      return new Response(null, { status: 410 });
    const path = new URL(request.url).pathname;
    const headers = { "cache-control": "no-store" };
    if (request.method === "GET" && path === "/health")
      return Response.json({ runId: env.PROBE_RUN }, { headers });
    if (request.method !== "POST" || path !== "/probe")
      return new Response(null, { status: 404 });
    try {
      const measurements = await measureDatabase(pool(env));
      return Response.json(
        {
          runId: env.PROBE_RUN,
          // This header identifies execution placement; request.cf.colo is
          // the ingress location and must not be reported as execution colo.
          placement: request.headers.get("cf-placement"),
          ...measurements,
        },
        { headers },
      );
    } catch {
      return Response.json(
        { error: "Database probe failed." },
        { status: 503, headers },
      );
    }
  };
}

export default { fetch: createProbeHandler() };
