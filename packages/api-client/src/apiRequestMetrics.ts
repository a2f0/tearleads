import type { HttpOperation } from "@tearleads/validators/operation";
import type { ApiReachabilityProbe } from "./apiReachabilityProbe";
import {
  type ApiRequestDurationSummary,
  DurationSampleWindow,
} from "./durationSampleWindow";
import type { ApiServerTiming } from "./serverTiming";

export interface ApiRequestCounts {
  readonly total: number;
  readonly inFlight: number;
  readonly succeeded: number;
  readonly failed: number;
  readonly cancelled: number;
}

export interface ApiRequestEndpointCounts extends ApiRequestCounts {
  readonly method: string;
  readonly path: string;
  /** Dispatch until response headers, a connection failure, or cancellation. */
  readonly duration: ApiRequestDurationSummary | null;
  /** The API's Server-Timing `total`; null until a response reports it. */
  readonly serverDuration: ApiRequestDurationSummary | null;
  /** The API's Server-Timing `db`; null until a response reports it. */
  readonly databaseDuration: ApiRequestDurationSummary | null;
}

export interface ApiRequestMetricsSnapshot extends ApiRequestCounts {
  readonly startedAt: string;
  readonly endpoints: readonly ApiRequestEndpointCounts[];
}

export interface ApiRequestInstrumentation {
  readonly metrics: ApiRequestMetrics;
  readonly getIdentity: () => string | null;
  /** Host-enabled follow-up probe that classifies failed fetches. */
  readonly networkFailureProbe?: ApiReachabilityProbe | null | undefined;
  /**
   * The host's authoritative connectivity reading (a native source where the
   * WebView's `navigator.onLine` is wrong); null defers to `navigator.onLine`.
   */
  readonly isOnline?: (() => boolean | null) | undefined;
}

type Outcome = "succeeded" | "failed" | "cancelled";

interface EndpointDurations {
  readonly duration: DurationSampleWindow;
  readonly serverDuration: DurationSampleWindow;
  readonly databaseDuration: DurationSampleWindow;
}

const emptyCounts: ApiRequestCounts = {
  total: 0,
  inFlight: 0,
  succeeded: 0,
  failed: 0,
  cancelled: 0,
};

type EndpointDurationSummaries = Pick<
  ApiRequestEndpointCounts,
  "duration" | "serverDuration" | "databaseDuration"
>;

const emptyDurations: EndpointDurationSummaries = {
  duration: null,
  serverDuration: null,
  databaseDuration: null,
};

function emptySnapshot(): ApiRequestMetricsSnapshot {
  return { ...emptyCounts, startedAt: new Date().toISOString(), endpoints: [] };
}

function endpointKey(row: { readonly method: string; readonly path: string }) {
  return `${row.method} ${row.path}`;
}

/**
 * In-memory HTTP attempt counts and durations, partitioned by identity at
 * dispatch time. Only operation templates are retained: no URLs, queries,
 * bodies or tokens. Hosts may reuse this store across client lifetimes until a
 * page reload.
 */
export class ApiRequestMetrics {
  private readonly scopes = new Map<string | null, ApiRequestMetricsSnapshot>();
  private readonly durations = new Map<
    string | null,
    Map<string, EndpointDurations>
  >();
  private readonly listeners = new Set<() => void>();
  private readonly generations = new Map<string | null, number>();

  /** `now` must be monotonic; tests inject a fake clock. */
  constructor(private readonly now: () => number = () => performance.now()) {}

  getSnapshot = (identity: string | null): ApiRequestMetricsSnapshot => {
    let snapshot = this.scopes.get(identity);
    if (!snapshot) {
      snapshot = emptySnapshot();
      this.scopes.set(identity, snapshot);
    }
    return snapshot;
  };

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  reset(identity: string | null): void {
    this.generations.set(identity, (this.generations.get(identity) ?? 0) + 1);
    this.scopes.set(identity, emptySnapshot());
    this.durations.delete(identity);
    this.notify();
  }

  begin(
    identity: string | null,
    operation: HttpOperation,
  ): (outcome: Outcome, serverTiming?: ApiServerTiming | null) => void {
    const generation = this.generations.get(identity) ?? 0;
    const startedAt = this.now();
    const previous = this.getSnapshot(identity);
    const existing = previous.endpoints.find(
      (row) => row.method === operation.method && row.path === operation.path,
    );
    let row: ApiRequestEndpointCounts = {
      ...emptyDurations,
      ...(existing ?? emptyCounts),
      method: operation.method,
      path: operation.path,
      total: (existing?.total ?? 0) + 1,
      inFlight: (existing?.inFlight ?? 0) + 1,
    };
    this.update(identity, previous, existing, row, {
      total: previous.total + 1,
      inFlight: previous.inFlight + 1,
    });
    // Reset replaces the scope's endpoints. Capture a generation independently
    // of snapshots, which are replaced for every concurrent request update.
    let completed = false;
    return (outcome, serverTiming) => {
      if (completed) return;
      completed = true;
      if ((this.generations.get(identity) ?? 0) !== generation) return;
      const current = this.getSnapshot(identity);
      const endpoint = current.endpoints.find(
        (candidate) =>
          candidate.method === row.method && candidate.path === row.path,
      );
      if (!endpoint) return;
      row = {
        ...endpoint,
        ...this.recordDurations(
          identity,
          endpoint,
          this.now() - startedAt,
          serverTiming,
        ),
        inFlight: endpoint.inFlight - 1,
        [outcome]: endpoint[outcome] + 1,
      };
      this.update(identity, current, endpoint, row, {
        inFlight: current.inFlight - 1,
        [outcome]: current[outcome] + 1,
      });
    };
  }

  private recordDurations(
    identity: string | null,
    endpoint: ApiRequestEndpointCounts,
    elapsedMs: number,
    serverTiming: ApiServerTiming | null | undefined,
  ): EndpointDurationSummaries {
    let byEndpoint = this.durations.get(identity);
    if (!byEndpoint) {
      byEndpoint = new Map();
      this.durations.set(identity, byEndpoint);
    }
    const key = endpointKey(endpoint);
    let windows = byEndpoint.get(key);
    if (!windows) {
      windows = {
        duration: new DurationSampleWindow(),
        serverDuration: new DurationSampleWindow(),
        databaseDuration: new DurationSampleWindow(),
      };
      byEndpoint.set(key, windows);
    }
    windows.duration.record(elapsedMs);
    const serverMs = serverTiming?.totalMs;
    if (typeof serverMs === "number") windows.serverDuration.record(serverMs);
    const databaseMs = serverTiming?.databaseMs;
    if (typeof databaseMs === "number") {
      windows.databaseDuration.record(databaseMs);
    }
    return {
      duration: windows.duration.summarize(),
      serverDuration: windows.serverDuration.summarize(),
      databaseDuration: windows.databaseDuration.summarize(),
    };
  }

  private update(
    identity: string | null,
    previous: ApiRequestMetricsSnapshot,
    existing: ApiRequestEndpointCounts | undefined,
    row: ApiRequestEndpointCounts,
    counts: Partial<ApiRequestCounts>,
  ): void {
    const endpoints = existing
      ? previous.endpoints.map((candidate) =>
          candidate === existing ? row : candidate,
        )
      : [...previous.endpoints, row];
    endpoints.sort(
      (left, right) =>
        right.total - left.total ||
        endpointKey(left).localeCompare(endpointKey(right), "en"),
    );
    this.scopes.set(identity, { ...previous, ...counts, endpoints });
    this.notify();
  }

  private notify(): void {
    for (const listener of this.listeners) {
      // Instrumentation must never change a request's outcome.
      try {
        listener();
      } catch {
        /* A broken observer cannot block HTTP. */
      }
    }
  }
}
