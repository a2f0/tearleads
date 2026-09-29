import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import { accessManifestVerifications } from "@tearleads/api-shared/schema";
import { inArray, sql } from "drizzle-orm";

// Keeps each IN list and VALUES batch well inside every dialect's bind limit.
const BATCH_SIZE = 500;

/** Stored verification MACs by manifest hash; unmarked hashes are absent. */
export async function selectAccessManifestVerificationMacs(
  manifestHashes: readonly string[],
  executor: DatabaseSession,
): Promise<Map<string, string>> {
  const macs = new Map<string, string>();
  for (let offset = 0; offset < manifestHashes.length; offset += BATCH_SIZE) {
    const rows = await executor
      .select({
        manifestHash: accessManifestVerifications.manifestHash,
        mac: accessManifestVerifications.mac,
      })
      .from(accessManifestVerifications)
      .where(
        inArray(
          accessManifestVerifications.manifestHash,
          manifestHashes.slice(offset, offset + BATCH_SIZE),
        ),
      );
    for (const row of rows) macs.set(row.manifestHash, row.mac);
  }
  return macs;
}

/**
 * Write verification MACs, replacing any from older rules or another secret.
 * One sorted pass, so overlapping writers lock rows in the same order.
 */
export async function upsertAccessManifestVerificationMacs(
  macs: ReadonlyMap<string, string>,
  executor: DatabaseSession,
  rowsPerStatement = BATCH_SIZE,
): Promise<void> {
  const rows = [...macs]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([manifestHash, mac]) => ({ manifestHash, mac }));
  for (let offset = 0; offset < rows.length; offset += rowsPerStatement) {
    await executor
      .insert(accessManifestVerifications)
      .values(rows.slice(offset, offset + rowsPerStatement))
      .onConflictDoUpdate({
        target: accessManifestVerifications.manifestHash,
        set: { mac: sql`excluded.mac` },
      });
  }
}
