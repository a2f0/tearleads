import { compareCanonicalStrings } from "@tearleads/crypto";
import { type SQL, sql } from "drizzle-orm";
import { z } from "zod";
import type { ApiServiceRuntime } from "../runtime";

const discoveryRowOrderSchema = z.object({
  discoveryOrder: z.string().regex(/^-?\d+$/u),
  id: z.string(),
});

function sortDiscoveryRows(rows: readonly unknown[]): unknown[] {
  if (rows.length <= 1) return [...rows];
  return [...rows].sort((left, right) => {
    const leftOrder = discoveryRowOrderSchema.safeParse(left);
    const rightOrder = discoveryRowOrderSchema.safeParse(right);
    if (!leftOrder.success || !rightOrder.success) return 0;
    const leftSeq = BigInt(leftOrder.data.discoveryOrder);
    const rightSeq = BigInt(rightOrder.data.discoveryOrder);
    if (leftSeq !== rightSeq) return leftSeq < rightSeq ? -1 : 1;
    return compareCanonicalStrings(leftOrder.data.id, rightOrder.data.id);
  });
}

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
  // Inner query bounds the page; sort the small JSON array in JS instead of
  // inside jsonb_agg so Postgres skips redundant aggregate Sort nodes (#3396).
  const result = await runtime.db.execute(sql`
    select
      publication::text as publication,
      (select coalesce(jsonb_agg(rows), '[]'::jsonb)
       from (${live}) rows) as live
    from drizzle.discovery_cursor_key where singleton and backfill_complete
  `);
  const parsed = liveSource.parse(result.rows[0]);
  return { ...parsed, live: sortDiscoveryRows(parsed.live) };
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
      (select coalesce(jsonb_agg(rows), '[]'::jsonb)
       from (${live}) rows) as live,
      (select coalesce(jsonb_agg(rows), '[]'::jsonb)
       from (${removed}) rows) as removed
    from drizzle.discovery_cursor_key where singleton and backfill_complete
  `);
  const parsed = sources.parse(result.rows[0]);
  return {
    ...parsed,
    live: sortDiscoveryRows(parsed.live),
    removed: sortDiscoveryRows(parsed.removed),
  };
}
