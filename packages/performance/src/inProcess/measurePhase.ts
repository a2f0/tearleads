import type { LocalSqlAttribution } from "../localDatabase";
import { type ResourceUse, startResourceSampler } from "../realtime/resources";
import { type HttpWireTraffic, httpTrafficSince } from "./httpCounterProxy";
import { type PostgresTraffic, trafficSince } from "./postgresWire";

export interface LocalSqlPhaseStats {
  readonly calls: number;
  readonly durationMs: number;
  readonly attribution?: LocalSqlAttribution;
}

export interface PhaseDeviceObserver {
  readonly localSql: () => {
    readonly calls: number;
    readonly durationMs: number;
  };
  readonly captureSqlWindow?: () => { finish(): LocalSqlAttribution };
}

export interface MeasuredPhaseStats {
  readonly wallMs: number;
  readonly http: HttpWireTraffic;
  readonly database: PostgresTraffic;
  readonly localSql?: LocalSqlPhaseStats;
  readonly resources: ResourceUse;
}

/**
 * Measures one async protocol phase across wall time, HTTP wire traffic,
 * PostgreSQL wire traffic, optional actor-device local SQLite work, and
 * process CPU/memory peaks.
 */
export async function measureProtocolPhase<T>(input: {
  readonly http: () => HttpWireTraffic;
  readonly traffic: () => PostgresTraffic;
  readonly device?: () => PhaseDeviceObserver | null;
  readonly run: () => Promise<T>;
  readonly sampleResources?: typeof startResourceSampler;
}): Promise<{ readonly value: T; readonly stats: MeasuredPhaseStats }> {
  const httpBefore = input.http();
  const dbBefore = input.traffic();
  const deviceBefore = input.device?.() ?? null;
  const localBefore = deviceBefore?.localSql() ?? null;
  const sqlWindow = deviceBefore?.captureSqlWindow?.();
  const resources = (input.sampleResources ?? startResourceSampler)();
  const startedAt = performance.now();

  let value: T;
  let attribution: LocalSqlAttribution | undefined;
  let resourceUse: ResourceUse;
  let wallMs: number;
  try {
    value = await input.run();
  } finally {
    wallMs = Math.round(performance.now() - startedAt);
    resourceUse = resources.stop();
    attribution = sqlWindow?.finish();
  }

  const deviceAfter = deviceBefore ?? input.device?.() ?? null;
  const localAfter = deviceAfter?.localSql() ?? null;
  const localSql: LocalSqlPhaseStats | undefined =
    localAfter !== null
      ? {
          calls: localAfter.calls - (localBefore?.calls ?? 0),
          durationMs: Math.round(
            localAfter.durationMs - (localBefore?.durationMs ?? 0),
          ),
          ...(attribution ? { attribution } : {}),
        }
      : undefined;

  return {
    value,
    stats: {
      wallMs,
      http: httpTrafficSince(input.http(), httpBefore),
      database: trafficSince(input.traffic(), dbBefore),
      ...(localSql ? { localSql } : {}),
      resources: resourceUse,
    },
  };
}
