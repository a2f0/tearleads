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

const liveSource = z.object({
  publication: z.string().regex(/^\d+$/u),
  live: z.array(z.unknown()),
});

const sources = liveSource.extend({
  removed: z.array(z.unknown()),
});

/** Reads one bounded live scan with the publication counter from one snapshot. */
export async function readDiscoverySource(
  runtime: ApiServiceRuntime,
  live: SQL,
) {
  const result = await runtime.db.execute(sql`
    select
      publication::text as publication,
      (select coalesce(jsonb_agg(rows order by rows."discoveryOrder"::bigint, rows.id), '[]'::jsonb)
       from (${live}) rows) as live
    from drizzle.discovery_cursor_key where singleton and backfill_complete
  `);
  return liveSource.parse(result.rows[0]);
}

/** Both bounded scans see the same MVCC snapshot, including on a replica. */
export async function readDiscoverySources(
  runtime: ApiServiceRuntime,
  live: SQL,
  removed: SQL,
) {
  const result = await runtime.db.execute(sql`
    select
      publication::text as publication,
      (select coalesce(jsonb_agg(rows order by rows."discoveryOrder"::bigint, rows.id), '[]'::jsonb)
       from (${live}) rows) as live,
      (select coalesce(jsonb_agg(rows order by rows."discoveryOrder"::bigint, rows.id), '[]'::jsonb)
       from (${removed}) rows) as removed
    from drizzle.discovery_cursor_key where singleton and backfill_complete
  `);
  return sources.parse(result.rows[0]);
}
