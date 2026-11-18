import { type SQL, sql } from "drizzle-orm";
import { z } from "zod";
import type { ApiServiceRuntime } from "../runtime";

export async function readDiscoveryKey(
  runtime: ApiServiceRuntime,
): Promise<string> {
  const result = await runtime.db.execute(
    sql`select key_material from drizzle.discovery_cursor_key where singleton and backfill_complete`,
  );
  return z.object({ key_material: z.string().min(32) }).parse(result.rows[0])
    .key_material;
}

const sources = z.object({
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
    select
      (select coalesce(jsonb_agg(rows order by rows."discoveryOrder"::bigint, rows.id), '[]'::jsonb)
       from (${live}) rows) as live,
      (select coalesce(jsonb_agg(rows order by rows."discoveryOrder"::bigint, rows.id), '[]'::jsonb)
       from (${removed}) rows) as removed
  `);
  return sources.parse(result.rows[0]);
}
