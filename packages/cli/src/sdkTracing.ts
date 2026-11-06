import {
  ApiRequestMetrics,
  getOrCreateDomainSyncCoordinator,
  type Tearleads,
} from "@tearleads/client-sdk";
import { formatDuration, type Tracer } from "./trace";

type BeginArguments = Parameters<ApiRequestMetrics["begin"]>;
type Finish = ReturnType<ApiRequestMetrics["begin"]>;

/**
 * The SDK's per-request metrics, also tracing each request: method and path
 * template (never a URL, query, or body), outcome, client duration, and the
 * API's Server-Timing total and database time when it reports them.
 */
export class TracingApiRequestMetrics extends ApiRequestMetrics {
  private nextRequest = 0;

  constructor(private readonly tracer: Tracer) {
    super();
  }

  override begin(...[identity, operation]: BeginArguments): Finish {
    const finish = super.begin(identity, operation);
    if (!this.tracer.enabled) return finish;
    const id = ++this.nextRequest;
    const endpoint = `${operation.method} ${operation.path}`;
    const startedAt = performance.now();
    this.tracer.event(`api #${id} -> ${endpoint}`);
    return (outcome, serverTiming) => {
      const ms = performance.now() - startedAt;
      this.tracer.recordRequest(endpoint, ms);
      const server = [
        serverTiming?.totalMs != null
          ? `server ${formatDuration(serverTiming.totalMs)}`
          : null,
        serverTiming?.databaseMs != null
          ? `db ${formatDuration(serverTiming.databaseMs)}`
          : null,
      ].filter((part) => part !== null);
      const detail = server.length > 0 ? ` (${server.join(", ")})` : "";
      this.tracer.event(
        `api #${id} <- ${endpoint} ${outcome} in ${formatDuration(ms)}${detail}`,
      );
      finish(outcome, serverTiming);
    };
  }
}

/**
 * Traces each sync lane's runs on the session's current scope: when a lane
 * starts, completes (with the run's duration), or fails.
 */
export function traceSyncLanes(sdk: Tearleads, tracer: Tracer): () => void {
  if (!tracer.enabled) return () => undefined;
  const coordinator = getOrCreateDomainSyncCoordinator(
    sdk.runtime.input().state.domainScope,
  );
  const seen = new Map<string, string>();
  return coordinator.subscribe(() => {
    for (const lane of coordinator.getSnapshot().lanes) {
      const action = `${lane.lastAction}@${lane.lastActionAt}`;
      if (seen.get(lane.key) === action) continue;
      seen.set(lane.key, action);
      const message = syncLaneMessage(lane);
      if (message !== null) tracer.event(message);
    }
  });
}

type SyncLaneSnapshot = ReturnType<
  ReturnType<typeof getOrCreateDomainSyncCoordinator>["getSnapshot"]
>["lanes"][number];

function syncLaneMessage(lane: SyncLaneSnapshot): string | null {
  switch (lane.lastAction) {
    case "started":
      return `sync ${lane.label}: started`;
    case "completed": {
      const ms = lane.runDurations?.lastMs;
      const took = ms === undefined ? "" : ` in ${formatDuration(ms)}`;
      return `sync ${lane.label}: completed${took}`;
    }
    case "failed":
      return `sync ${lane.label}: failed: ${lane.lastError ?? "unknown error"}`;
    default:
      return null;
  }
}
