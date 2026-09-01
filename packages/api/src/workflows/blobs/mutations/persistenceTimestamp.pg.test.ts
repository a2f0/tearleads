import { expect, test } from "bun:test";
import { db, getDefaultApiDatabaseKind } from "@tearleads/api-shared/postgres";
import { blobs } from "@tearleads/api-shared/schema";
import { eq, sql } from "drizzle-orm";
import { markBlobDereferencedIfInactive } from "./persistence";

function milliseconds(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error("Expected a database timestamp in milliseconds");
  }
  return parsed;
}

test.skipIf(getDefaultApiDatabaseKind() !== "postgres")(
  "a delayed transaction starts the grace clock after reachability checking",
  async () => {
    const blobId = crypto.randomUUID();
    await db.insert(blobs).values({
      byteLength: 1,
      id: blobId,
      sha256: `sha256:${blobId}`,
      storageKey: `blob-object:${blobId}`,
    });

    try {
      await db.transaction(async (tx) => {
        const [started] = await tx
          .select({
            transactionStartedMs: sql<string>`extract(epoch from transaction_timestamp()) * 1000`,
          })
          .from(blobs)
          .where(eq(blobs.id, blobId))
          .limit(1);
        if (!started) {
          throw new Error("Expected PostgreSQL transaction timestamp");
        }

        await new Promise<void>((resolve) => setTimeout(resolve, 100));
        await markBlobDereferencedIfInactive({ blobId, executor: tx });

        const [marked] = await tx
          .select({
            dereferencedMs: sql<string>`extract(epoch from ${blobs.dereferencedAt}) * 1000`,
          })
          .from(blobs)
          .where(eq(blobs.id, blobId));
        if (!marked) {
          throw new Error("Expected dereferenced blob timestamp");
        }

        expect(
          milliseconds(marked.dereferencedMs) -
            milliseconds(started.transactionStartedMs),
        ).toBeGreaterThanOrEqual(75);
      });
    } finally {
      await db.delete(blobs).where(eq(blobs.id, blobId));
    }
  },
);
