import { type SQL, sql } from "drizzle-orm";
import { z } from "zod";
import type { ApiServiceRuntime } from "../runtime";

export const discoveryWalPosition = sql`(case when pg_is_in_recovery() then pg_last_wal_replay_lsn() else pg_current_wal_insert_lsn() end)`;

export async function readDiscoveryKey(
  runtime: ApiServiceRuntime,
): Promise<string> {
  const result = await runtime.db.execute(
    sql`select key_material from drizzle.discovery_cursor_key where singleton`,
  );
  return z.object({ key_material: z.string().min(32) }).parse(result.rows[0])
    .key_material;
}

const sources = z.object({
  walPosition: z.string(),
  live: z.array(z.unknown()),
  removed: z.array(z.unknown()),
});

/** Both bounded scans see the same MVCC snapshot, including on a replica. */
export async function readDiscoverySources(
  runtime: ApiServiceRuntime,
  live: SQL,
  removed: SQL,
) {
  const result = await runtime.db.execute(sql`
    select ${discoveryWalPosition}::text as "walPosition",
      (select coalesce(jsonb_agg(rows order by rows."discoveryOrder"::bigint, rows.id), '[]'::jsonb)
       from (${live}) rows) as live,
      (select coalesce(jsonb_agg(rows order by rows."discoveryOrder"::bigint, rows.id), '[]'::jsonb)
       from (${removed}) rows) as removed
  `);
  return sources.parse(result.rows[0]);
}
