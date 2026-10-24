export const runHeader = "x-tearleads-perf-run";
export const requestHeader = "x-tearleads-perf-request";

export interface RequestMeasurement {
  id: string;
  phase: string;
  method: string;
  route: string;
  startMs: number;
  headersMs: number;
  status: number | null;
  serverMs: number | null;
  databaseMs: number | null;
  cfRay: string | null;
  apiVersion: string | null;
  outcome: "response" | "transport-error";
}

function timing(header: string | null, metric: string): number | null {
  // The API emits exactly `total;dur=N, db;dur=N`, with no descriptions.
  const value = header?.match(
    new RegExp(`(?:^|,)\\s*${metric};dur=(\\d+(?:\\.\\d+)?)(?:\\s*(?:,|$))`),
  )?.[1];
  const number = value === undefined ? NaN : Number(value);
  return Number.isFinite(number) ? number : null;
}

export function createMeasuredFetch(input: {
  fetch: typeof fetch;
  origin: string;
  runId: string;
  sampleId: string;
  startedAt: number;
  phase: () => string;
  signal: AbortSignal;
  requests: RequestMeasurement[];
}): typeof fetch {
  const measured = async (
    resource: Parameters<typeof fetch>[0],
    init?: RequestInit,
  ) => {
    const request = new Request(resource, init);
    if (new URL(request.url).origin !== input.origin) {
      throw new Error(
        "Experiment attempted a request outside its selected API.",
      );
    }
    input.signal.throwIfAborted();
    const id = `${input.sampleId}-${input.requests.length + 1}`;
    request.headers.set(runHeader, input.runId);
    request.headers.set(requestHeader, id);
    const start = performance.now();
    const row: RequestMeasurement = {
      id,
      phase: input.phase(),
      method: request.method,
      // Only these fixed paths are retained, never arbitrary IDs or queries.
      route: [
        "/auth/register",
        "/auth/challenge",
        "/auth/verify",
        "/auth/logout",
      ].includes(new URL(request.url).pathname)
        ? new URL(request.url).pathname
        : "other",
      startMs: start - input.startedAt,
      headersMs: 0,
      status: null,
      serverMs: null,
      databaseMs: null,
      cfRay: null,
      apiVersion: null,
      outcome: "transport-error",
    };
    input.requests.push(row);
    try {
      const response = await input.fetch(request, {
        signal: AbortSignal.any([request.signal, input.signal]),
        redirect: "error",
      });
      row.status = response.status;
      row.serverMs = timing(response.headers.get("server-timing"), "total");
      row.databaseMs = timing(response.headers.get("server-timing"), "db");
      row.cfRay = response.headers.get("cf-ray");
      row.apiVersion = response.headers.get("x-tearleads-api-version");
      row.outcome = "response";
      return response;
    } finally {
      row.headersMs = performance.now() - start;
    }
  };
  return Object.assign(measured, { preconnect: input.fetch.preconnect });
}
