import {
  type ExecSqlClientLike,
  observeClientSqlMutations,
  type SqlBind,
} from "@tearleads/client-sdk/sqlite";
import {
  execDatabaseStatement,
  initDatabase,
} from "@tearleads/sqlite-worker/load-sqlite3";
import {
  type ClientSqlTopEntry,
  normalizeClientSql,
} from "./statements/clientSqlSummary";

export interface LocalSqlAttribution {
  readonly top: readonly ClientSqlTopEntry[];
  readonly mutations: number;
  readonly maxMutationHoldMs: number;
  readonly maxStatementsPerMutation: number;
}

interface SqlSample {
  count: number;
  durationMs: number;
  rawSql: string;
  bind?: SqlBind;
}

function roundMs(value: number): number {
  return Math.round(value * 10) / 10;
}

function extractPlanFlags(
  database: Awaited<ReturnType<typeof initDatabase>>,
  rawSql: string,
  bind: SqlBind | undefined,
): string[] {
  if (!/^\s*select\b/iu.test(rawSql)) return [];
  try {
    const rows = execDatabaseStatement(database, {
      sql: `EXPLAIN QUERY PLAN ${rawSql}`,
      ...(bind !== undefined ? { bind } : {}),
      rowMode: "object",
    });
    const flags = new Set<string>();
    for (const row of rows) {
      if (Array.isArray(row)) continue;
      const detail = Reflect.get(row, "detail");
      if (typeof detail !== "string") continue;
      if (/\bSCAN\b/u.test(detail)) flags.add("SCAN");
      if (/USE TEMP B-TREE/iu.test(detail)) flags.add("USE TEMP B-TREE");
    }
    return [...flags];
  } catch {
    return [];
  }
}

function recordSample(
  windows: ReadonlySet<Map<string, SqlSample>>,
  rawSql: string,
  bind: SqlBind | undefined,
  elapsed: number,
): void {
  if (windows.size === 0) return;
  const normalized = normalizeClientSql(rawSql);
  for (const bucket of windows) {
    const existing = bucket.get(normalized);
    if (existing) {
      existing.count += 1;
      existing.durationMs += elapsed;
    } else {
      bucket.set(normalized, {
        count: 1,
        durationMs: elapsed,
        rawSql,
        ...(bind !== undefined ? { bind } : {}),
      });
    }
  }
}

export async function openLocalDatabase() {
  const database = await initDatabase({
    dbName: `/${crypto.randomUUID()}.db`,
    cipher: "chacha20",
    key: crypto.randomUUID(),
    persistence: "memory",
  });
  const measurements = { calls: 0, durationMs: 0 };
  const activeWindows = new Set<Map<string, SqlSample>>();
  const client: ExecSqlClientLike = {
    exec: async (options) => {
      const startedAt = performance.now();
      try {
        return { rows: execDatabaseStatement(database, options) };
      } finally {
        const elapsed = performance.now() - startedAt;
        measurements.calls += 1;
        measurements.durationMs += elapsed;
        recordSample(activeWindows, options.sql, options.bind, elapsed);
      }
    },
  };

  function captureSqlWindow() {
    const bucket = new Map<string, SqlSample>();
    activeWindows.add(bucket);
    let mutations = 0;
    let maxMutationHoldMs = 0;
    let maxStatementsPerMutation = 0;
    const stopMutations = observeClientSqlMutations((mut) => {
      mutations += 1;
      if (mut.holdMs > maxMutationHoldMs) maxMutationHoldMs = mut.holdMs;
      if (mut.statements > maxStatementsPerMutation)
        maxStatementsPerMutation = mut.statements;
    });
    return {
      finish(): LocalSqlAttribution {
        activeWindows.delete(bucket);
        stopMutations();
        const ranked = [...bucket]
          .sort(
            (a, b) =>
              b[1].count - a[1].count || b[1].durationMs - a[1].durationMs,
          )
          .slice(0, 10)
          .map(([sql, sample]): ClientSqlTopEntry => {
            const planFlags = extractPlanFlags(
              database,
              sample.rawSql,
              sample.bind,
            );
            return {
              sql,
              count: sample.count,
              durationMs: roundMs(sample.durationMs),
              ...(planFlags.length > 0 ? { planFlags } : {}),
            };
          });
        return {
          top: ranked,
          mutations,
          maxMutationHoldMs: roundMs(maxMutationHoldMs),
          maxStatementsPerMutation,
        };
      },
    };
  }

  return {
    client,
    measurements,
    captureSqlWindow,
    close: () => database.close(),
  };
}
