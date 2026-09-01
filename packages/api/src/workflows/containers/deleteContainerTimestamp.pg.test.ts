import { expect, test } from "bun:test";
import { db, getDefaultApiDatabaseKind } from "@tearleads/api-shared/postgres";
import {
  attachmentBindings,
  blobs,
  documentContainerLinks,
  documents,
} from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/bob-and-alice";
import type { AccessManifestBundleWire } from "@tearleads/validators/request";
import { eq, sql } from "drizzle-orm";
import { authenticate } from "../../../test/helpers/authenticate";
import { createChildContainer } from "../../../test/helpers/keyingWriterProjectionChild";
import {
  asVerifiedContainerManifest,
  bootstrapRoot,
} from "../../../test/helpers/keyingWriterProjectionKit";
import { registerUser } from "../../../test/helpers/registerUser";
import { deleteContainer } from "./deleteContainer";

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
  throw new Error("Container deletion did not wait on the blob lock");
}

test.skipIf(getDefaultApiDatabaseKind() !== "postgres")(
  "container teardown starts the blob grace clock after a delayed lock",
  async () => {
    const owner = createTestUser();
    await registerUser(owner);
    await authenticate(owner);
    const root = await bootstrapRoot(owner);
    const child = await createChildContainer({ parent: root, signer: owner });
    const childManifest = asVerifiedContainerManifest(
      child.accessManifest as AccessManifestBundleWire,
    );
    const metadataDocumentId = childManifest.state.metadataDocumentId;
    const blobId = crypto.randomUUID();

    await db.insert(documents).values({
      createdByFingerprint: owner.fingerprint,
      id: metadataDocumentId,
    });
    await db.insert(documentContainerLinks).values({
      containerId: child.containerId,
      documentId: metadataDocumentId,
    });
    await db.insert(blobs).values({
      byteLength: 1,
      id: blobId,
      sha256: `sha256:${blobId}`,
      storageKey: `blob-object:${blobId}`,
    });
    await db.insert(attachmentBindings).values({
      blobId,
      documentId: metadataDocumentId,
      id: crypto.randomUUID(),
      slotId: "container-delete-timestamp",
    });

    let deletion: ReturnType<typeof deleteContainer> | undefined;
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
          .select({ id: blobs.id })
          .from(blobs)
          .where(eq(blobs.id, blobId))
          .for("update");

        deletion = deleteContainer(db, {
          containerId: child.containerId,
          userId: owner.userId,
        });
        await Promise.race([
          waitForBlockedBackend(blockerPid),
          deletion.then(() => {
            throw new Error("Container deletion bypassed the blob lock");
          }),
        ]);
        await new Promise<void>((resolve) => setTimeout(resolve, 100));
        blockerReleasedAt = Date.now();
      });

      if (!deletion) {
        throw new Error("Expected container deletion to start");
      }
      await deletion;
      const [blob] = await db
        .select({ dereferencedAt: blobs.dereferencedAt })
        .from(blobs)
        .where(eq(blobs.id, blobId));
      expect(blob?.dereferencedAt).toBeInstanceOf(Date);
      expect(blob?.dereferencedAt?.getTime()).toBeGreaterThanOrEqual(
        blockerReleasedAt - 20,
      );
    } finally {
      await deletion?.catch(() => undefined);
      await db
        .delete(attachmentBindings)
        .where(eq(attachmentBindings.blobId, blobId));
      await db.delete(blobs).where(eq(blobs.id, blobId));
    }
  },
  15_000,
);
