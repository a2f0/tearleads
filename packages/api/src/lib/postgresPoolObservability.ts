import type { Pool as PgPool } from 'pg';

const DEFAULT_REPLICA_MAX_LAG_SECONDS = 5;

function parseReplicaMaxLagSeconds(): number {
  const raw = process.env['POSTGRES_REPLICA_MAX_LAG_SECONDS'];
  if (!raw) {
    return DEFAULT_REPLICA_MAX_LAG_SECONDS;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return DEFAULT_REPLICA_MAX_LAG_SECONDS;
  }

  return parsed;
}

export function logPoolStats(
  poolInstance: PgPool,
  poolType: 'primary' | 'replica'
): void {
  console.info('postgres_pool_stats', {
    pool: poolType,
    totalConnections: poolInstance.totalCount,
    idleConnections: poolInstance.idleCount,
    waitingRequests: poolInstance.waitingCount
  });
}

export async function validateReplicaHealth(
  replicaPoolInstance: PgPool
): Promise<boolean> {
  try {
    const result = await replicaPoolInstance.query<{
      pg_is_in_recovery: boolean;
      replay_lag_seconds: number | null;
      receive_lsn: string | null;
      replay_lsn: string | null;
    }>(
      `SELECT
         pg_is_in_recovery() AS pg_is_in_recovery,
         pg_last_wal_receive_lsn()::text AS receive_lsn,
         pg_last_wal_replay_lsn()::text AS replay_lsn,
         EXTRACT(EPOCH FROM COALESCE(NOW() - pg_last_xact_replay_timestamp(), INTERVAL '0'))::float8 AS replay_lag_seconds`
    );
    const row = result.rows[0];
    const inRecovery = row?.pg_is_in_recovery === true;
    const lagSeconds = row?.replay_lag_seconds ?? null;
    const receiveLsn = row?.receive_lsn ?? null;
    const replayLsn = row?.replay_lsn ?? null;
    const caughtUp = Boolean(receiveLsn && replayLsn && receiveLsn === replayLsn);
    const effectiveLagSeconds = caughtUp ? 0 : lagSeconds;
    const maxLagSeconds = parseReplicaMaxLagSeconds();
    const lagHealthy =
      effectiveLagSeconds === null ||
      (Number.isFinite(effectiveLagSeconds) &&
        effectiveLagSeconds <= maxLagSeconds);
    const healthy = inRecovery && lagHealthy;

    logPoolStats(replicaPoolInstance, 'replica');
    if (!healthy) {
      console.warn('postgres_replica_unhealthy', {
        inRecovery,
        lagSeconds,
        effectiveLagSeconds,
        receiveLsn,
        replayLsn,
        caughtUp,
        maxLagSeconds
      });
    }
    return healthy;
  } catch (error) {
    console.error('postgres_replica_health_check_failed', { error });
    return false;
  }
}
