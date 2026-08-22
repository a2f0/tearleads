import { expect, test } from "bun:test";
import { db, getDefaultApiDatabaseKind } from "@symcrypt/api-shared/postgres";
import { blobs, documents } from "@symcrypt/api-shared/schema";
import { eq, sql } from "drizzle-orm";
import { finalizeAttachmentMutation } from "./finalizeAttachmentMutation";

async function waitForBlockedBackend(blockerPid: number): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const result = await db.execute(sql`
      select exists (
        select 1
        from pg_stat_activity
        where ${blockerPid} = any(pg_blocking_pids(pid))
      ) as blocked
    `);
    if (Reflect.get(result.rows[0] ?? {}, "blocked") === true) {
      return;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Attachment finalization did not wait on the document lock");
}

test.skipIf(getDefaultApiDatabaseKind() !== "postgres")(
  "attachment finalization starts the blob grace clock after projection locks",
  async () => {
    const blobId = crypto.randomUUID();
    const documentId = crypto.randomUUID();
    await db.insert(documents).values({
      createdByFingerprint: "attachment-finalization-timestamp",
      id: documentId,
    });
    await db.insert(blobs).values({
      byteLength: 1,
      id: blobId,
      sha256: `sha256:${blobId}`,
      storageKey: `blob-object:${blobId}`,
    });

    let finalization: Promise<void> | undefined;
    try {
      let blockerReleasedAt = 0;
      await db.transaction(async (blocker) => {
        const pidResult = await blocker.execute(
          sql`select pg_backend_pid() as pid`,
        );
        const blockerPid = Number(Reflect.get(pidResult.rows[0] ?? {}, "pid"));
        if (!Number.isInteger(blockerPid)) {
          throw new Error("Expected PostgreSQL backend pid");
        }
        await blocker
          .select({ id: documents.id })
          .from(documents)
          .where(eq(documents.id, documentId))
          .for("update");

        finalization = db.transaction((tx) =>
          finalizeAttachmentMutation({
            dereferencedBlobId: blobId,
            documentId,
            executor: tx,
            linkedContainerIds: [],
          }),
        );
        await Promise.race([
          waitForBlockedBackend(blockerPid),
          finalization.then(() => {
            throw new Error(
              "Attachment finalization bypassed the document lock",
            );
          }),
        ]);
        await new Promise<void>((resolve) => setTimeout(resolve, 100));
        blockerReleasedAt = Date.now();
      });

      if (!finalization) {
        throw new Error("Expected attachment finalization to start");
      }
      await finalization;
      const [blob] = await db
        .select({ dereferencedAt: blobs.dereferencedAt })
        .from(blobs)
        .where(eq(blobs.id, blobId));
      expect(blob?.dereferencedAt).toBeInstanceOf(Date);
      expect(blob?.dereferencedAt?.getTime()).toBeGreaterThanOrEqual(
        blockerReleasedAt - 20,
      );
    } finally {
      await finalization?.catch(() => undefined);
      await db.delete(blobs).where(eq(blobs.id, blobId));
      await db.delete(documents).where(eq(documents.id, documentId));
    }
  },
  15_000,
);
