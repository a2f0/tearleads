import { jsonRecord as record } from "./jsonRecord";
import { requestHeader, runHeader } from "./transport";

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

export interface CostEvent {
  requestId: string;
  eventTimestamp: number | null;
  cpuMs: number | null;
  wallMs: number | null;
  costs: { statements: number; wallMs: number; dbMs: number; status: number }[];
}

function parseCost(message: unknown): CostEvent["costs"][number] | null {
  if (typeof message !== "string") return null;
  let cost: Record<string, unknown>;
  try {
    cost = record(JSON.parse(message));
  } catch {
    return null;
  }
  if (Reflect.get(cost, "event") !== "api.request.cost") return null;
  const statements = finite(Reflect.get(cost, "statements"));
  const wallMs = finite(Reflect.get(cost, "wallMs"));
  const dbMs = finite(Reflect.get(cost, "dbMs"));
  const status = finite(Reflect.get(cost, "status"));
  return statements !== null &&
    wallMs !== null &&
    dbMs !== null &&
    status !== null
    ? { statements, wallMs, dbMs, status }
    : null;
}

function parseCosts(logs: unknown): CostEvent["costs"] {
  if (!Array.isArray(logs)) return [];
  return logs.flatMap((entry) => {
    const messages: unknown = Reflect.get(record(entry), "message");
    return Array.isArray(messages)
      ? messages.flatMap((message) => {
          const cost = parseCost(message);
          return cost ? [cost] : [];
        })
      : [];
  });
}

/** Retain only measurements from our exact run, never raw invocation logs. */
export function sanitizeCostEvent(
  value: unknown,
  runId: string,
): CostEvent | null {
  const trace = record(value);
  const request = record(
    Reflect.get(record(Reflect.get(trace, "event")), "request"),
  );
  const headers = new Headers();
  for (const [key, value] of Object.entries(
    record(Reflect.get(request, "headers")),
  )) {
    if (typeof value === "string") headers.set(key, value);
  }
  const requestId = headers.get(requestHeader);
  if (
    headers.get(runHeader) !== runId ||
    !requestId ||
    !new RegExp(`^${runId}-[1-9]\\d?-[1-9]\\d*$`).test(requestId)
  )
    return null;
  return {
    requestId,
    eventTimestamp: finite(Reflect.get(trace, "eventTimestamp")),
    // Live tail does not always provide these. Missing is not zero CPU.
    cpuMs: finite(Reflect.get(trace, "cpuTime")),
    wallMs: finite(Reflect.get(trace, "wallTime")),
    costs: parseCosts(Reflect.get(trace, "logs")),
  };
}
