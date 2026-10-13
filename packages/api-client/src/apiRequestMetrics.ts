import type { HttpOperation } from "@tearleads/validators/operation";

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
}

export interface ApiRequestMetricsSnapshot extends ApiRequestCounts {
  readonly startedAt: string;
  readonly endpoints: readonly ApiRequestEndpointCounts[];
}

export interface ApiRequestInstrumentation {
  readonly metrics: ApiRequestMetrics;
  readonly getIdentity: () => string | null;
}

type Outcome = "succeeded" | "failed" | "cancelled";

const emptyCounts: ApiRequestCounts = {
  total: 0,
  inFlight: 0,
  succeeded: 0,
  failed: 0,
  cancelled: 0,
};

function emptySnapshot(): ApiRequestMetricsSnapshot {
  return { ...emptyCounts, startedAt: new Date().toISOString(), endpoints: [] };
}

/**
 * In-memory HTTP attempt counts, partitioned by identity at dispatch time.
 * Only operation templates are retained: no URLs, queries, bodies or tokens.
 * Hosts may reuse this store across client lifetimes until a page reload.
 */
export class ApiRequestMetrics {
  private readonly scopes = new Map<string | null, ApiRequestMetricsSnapshot>();
  private readonly listeners = new Set<() => void>();
  private readonly generations = new Map<string | null, number>();

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
    this.notify();
  }

  begin(
    identity: string | null,
    operation: HttpOperation,
  ): (outcome: Outcome) => void {
    const generation = this.generations.get(identity) ?? 0;
    const previous = this.getSnapshot(identity);
    const existing = previous.endpoints.find(
      (row) => row.method === operation.method && row.path === operation.path,
    );
    let row: ApiRequestEndpointCounts = {
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
    return (outcome) => {
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
        inFlight: endpoint.inFlight - 1,
        [outcome]: endpoint[outcome] + 1,
      };
      this.update(identity, current, endpoint, row, {
        inFlight: current.inFlight - 1,
        [outcome]: current[outcome] + 1,
      });
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
        `${left.method} ${left.path}`.localeCompare(
          `${right.method} ${right.path}`,
          "en",
        ),
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
