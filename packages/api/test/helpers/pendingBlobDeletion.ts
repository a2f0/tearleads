import type { ApiDatabase } from "@tearleads/api-shared/postgres";
import { blobAuditObjects, blobs } from "@tearleads/api-shared/schema";
import { sql } from "drizzle-orm";
import { wallClockNowExpression } from "../../src/utils/postgresSql";

export async function seedPendingBlobDeletion(
  db: ApiDatabase,
  organizationId: string,
  input: { readonly blobId?: string; readonly ageMs?: number } = {},
) {
  const blobId = input.blobId ?? crypto.randomUUID();
  const storageKey = `organizations/${organizationId}/blob-stages/${blobId}`;
  const byteLength = 23;
  const sha256 = "a".repeat(64);
  const [row] = await db
    .insert(blobs)
    .values({
      id: blobId,
      storageKey,
      byteLength,
      sha256,
      dereferencedAt: sql`${wallClockNowExpression()} - ${input.ageMs ?? 0} * interval '1 millisecond'`,
    })
    .returning({ dereferencedAt: blobs.dereferencedAt });
  if (!row?.dereferencedAt)
    throw new Error("Missing seeded dereference timestamp");
  await db.insert(blobAuditObjects).values({
    blobId,
    organizationId,
    byteLength,
    sha256,
    liveStorageKey: storageKey,
    historicalBytesRetained: false,
    retentionMode: "live_only",
  });
  return { blobId, byteLength, dereferencedAt: row.dereferencedAt, storageKey };
}
