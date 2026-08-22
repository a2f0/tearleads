import { expect, test } from "bun:test";
import { db, getDefaultApiDatabaseKind } from "@symcrypt/api-shared/postgres";
import { accessManifestHeads } from "@symcrypt/api-shared/schema";
import { and, eq } from "drizzle-orm";
import { gateTransactionSelectAfterExecution } from "../../../../test/helpers/gateDatabaseSelect";
import { lockAccessManifestHeadsForUpdate } from "../../../access/read/accessManifestStore";
import { lockAttachmentAuthorizationHeadsForShare } from "./authorizationLocks";

function deferred(): {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
} {
  let resolvePromise = () => {};
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

test.skipIf(getDefaultApiDatabaseKind() !== "postgres")(
  "attachment locking rejects a target head purged and recreated while waiting",
  async () => {
    const documentId = crypto.randomUUID();
    const organizationId = crypto.randomUUID();
    const head = {
      epoch: 1,
      manifestHash: `manifest:${documentId}`,
      objectId: documentId,
      objectKind: "document" as const,
      organizationId,
    };
    await db.insert(accessManifestHeads).values(head);

    const purgeReady = deferred();
    const releasePurge = deferred();
    const purge = db.transaction(async (tx) => {
      await lockAccessManifestHeadsForUpdate("document", [documentId], tx);
      await tx
        .delete(accessManifestHeads)
        .where(
          and(
            eq(accessManifestHeads.objectKind, "document"),
            eq(accessManifestHeads.objectId, documentId),
          ),
        );
      purgeReady.resolve();
      await releasePurge.promise;
    });
    await purgeReady.promise;

    const lockReadReturned = deferred();
    const lockAttempted = deferred();
    const releaseLockRead = deferred();
    const gatedDatabase = gateTransactionSelectAfterExecution({
      database: db,
      matchesSql: (sql) => sql.includes('from "access_manifest_heads"'),
      occurrence: 1,
      reached: lockReadReturned.resolve,
      release: releaseLockRead.promise,
    });
    const attachmentLock = gatedDatabase.transaction((tx) => {
      lockAttempted.resolve();
      return lockAttachmentAuthorizationHeadsForShare({
        containerIds: [],
        documentIds: [documentId],
        executor: tx,
      });
    });

    try {
      await lockAttempted.promise;
      releasePurge.resolve();
      await purge;
      await lockReadReturned.promise;
      await db.insert(accessManifestHeads).values(head);
      releaseLockRead.resolve();

      await expect(attachmentLock).rejects.toMatchObject({
        message: "Blob content-key target heads are stale",
        status: 409,
      });
    } finally {
      releasePurge.resolve();
      releaseLockRead.resolve();
      await Promise.all([
        purge.catch(() => undefined),
        attachmentLock.catch(() => undefined),
      ]);
    }
  },
  30_000,
);
