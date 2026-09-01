import { expect, test } from "bun:test";
import { db, getDefaultApiDatabaseKind } from "@tearleads/api-shared/postgres";
import {
  attachmentBindings,
  blobAuditObjects,
  blobs,
  documents,
} from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/bob-and-alice";
import { eq } from "drizzle-orm";
import { authenticate } from "../../../../test/helpers/authenticate";
import {
  bindForTest,
  buildBind,
  buildDetach,
  detachForTest,
  stageBlob,
} from "../../../../test/helpers/blobAttachmentKit";
import {
  bootstrapRoot,
  createDocument,
} from "../../../../test/helpers/keyingWriterProjectionKit";
import {
  holdPostgresLock,
  waitForPostgresLockWait,
} from "../../../../test/helpers/postgresConcurrency";
import { registerUser } from "../../../../test/helpers/registerUser";
import { lockRowForUpdate } from "../../../utils/sqlDialect";
import { runReclaimDereferencedBlobsWorkflow } from "./reclaimDereferencedBlobs";

const HOUR_MS = 60 * 60 * 1000;

async function createDereferencedBlobFixture() {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const document = await createDocument({ owner, root });
  const blobId = crypto.randomUUID();
  const initialBind = await buildBind({
    blobId,
    document,
    owner,
    root,
    slotId: "gc-race-initial",
    stagedBlob: await stageBlob(owner),
  });
  await bindForTest({
    blobId,
    owner,
    request: initialBind.request,
  });
  await detachForTest({
    binding: initialBind.binding,
    blobId,
    owner,
    request: await buildDetach({
      binding: initialBind.binding,
      document,
      owner,
      root,
    }),
  });

  const sweepAt = new Date();
  await db
    .update(blobs)
    .set({ dereferencedAt: new Date(sweepAt.getTime() - 48 * HOUR_MS) })
    .where(eq(blobs.id, blobId));
  const rebind = await buildBind({
    blobId,
    document,
    owner,
    root,
    slotId: "gc-race-rebind",
  });
  return { blobId, document, owner, rebind, sweepAt };
}

test.skipIf(getDefaultApiDatabaseKind() !== "postgres")(
  "a bind that locks first revives the blob before reclamation",
  async () => {
    const fixture = await createDereferencedBlobFixture();
    const documentLock = await holdPostgresLock(async (tx) => {
      const query = tx
        .select({ id: documents.id })
        .from(documents)
        .where(eq(documents.id, fixture.document.id))
        .limit(1);
      await lockRowForUpdate(query);
    });

    const bind = bindForTest({
      blobId: fixture.blobId,
      owner: fixture.owner,
      request: fixture.rebind.request,
    }).then(
      () => ({ kind: "fulfilled" as const }),
      (error: unknown) => ({ error, kind: "rejected" as const }),
    );
    let reclaim:
      | ReturnType<typeof runReclaimDereferencedBlobsWorkflow>
      | undefined;
    let synchronizationError: unknown;
    try {
      await waitForPostgresLockWait({
        blockerPid: documentLock.backendPid,
        queryFragment: "documents",
      });
      const activeReclaim = runReclaimDereferencedBlobsWorkflow(db, {
        gracePeriodMs: 24 * HOUR_MS,
        now: fixture.sweepAt,
      });
      reclaim = activeReclaim;
      await waitForPostgresLockWait({
        blockerPid: documentLock.backendPid,
        queryFragment: "blobs",
      });
    } catch (error) {
      synchronizationError = error;
    } finally {
      await documentLock.release();
    }
    if (synchronizationError) {
      await Promise.allSettled([bind, ...(reclaim ? [reclaim] : [])]);
      throw synchronizationError;
    }
    if (!reclaim) {
      throw new Error("Expected blob reclamation to start");
    }
    const [bindResult, result] = await Promise.all([bind, reclaim]);
    expect(bindResult).toEqual({ kind: "fulfilled" });
    expect(result.reclaimedBlobIds).not.toContain(fixture.blobId);
    const [blob] = await db
      .select({ dereferencedAt: blobs.dereferencedAt })
      .from(blobs)
      .where(eq(blobs.id, fixture.blobId));
    const [binding] = await db
      .select({ detachedAt: attachmentBindings.detachedAt })
      .from(attachmentBindings)
      .where(eq(attachmentBindings.id, fixture.rebind.binding.bindingId));
    expect(blob?.dereferencedAt).toBeNull();
    expect(binding?.detachedAt).toBeNull();
  },
  30_000,
);

test.skipIf(getDefaultApiDatabaseKind() !== "postgres")(
  "reclamation that locks first rejects the bind without a dangling row",
  async () => {
    const fixture = await createDereferencedBlobFixture();
    const auditLock = await holdPostgresLock(async (tx) => {
      const query = tx
        .select({ blobId: blobAuditObjects.blobId })
        .from(blobAuditObjects)
        .where(eq(blobAuditObjects.blobId, fixture.blobId))
        .limit(1);
      await lockRowForUpdate(query);
    });

    const reclaim = runReclaimDereferencedBlobsWorkflow(db, {
      gracePeriodMs: 24 * HOUR_MS,
      now: fixture.sweepAt,
    });
    let bind:
      | Promise<
          | { readonly kind: "fulfilled" }
          | { readonly error: unknown; readonly kind: "rejected" }
        >
      | undefined;
    let synchronizationError: unknown;
    try {
      await waitForPostgresLockWait({
        blockerPid: auditLock.backendPid,
        queryFragment: "blob_audit_objects",
      });
      bind = bindForTest({
        blobId: fixture.blobId,
        owner: fixture.owner,
        request: fixture.rebind.request,
      }).then(
        () => ({ kind: "fulfilled" as const }),
        (error: unknown) => ({ error, kind: "rejected" as const }),
      );
      await waitForPostgresLockWait({
        blockerPid: auditLock.backendPid,
        queryFragment: "blobs",
      });
    } catch (error) {
      synchronizationError = error;
    } finally {
      await auditLock.release();
    }
    if (synchronizationError) {
      await Promise.allSettled([reclaim, ...(bind ? [bind] : [])]);
      throw synchronizationError;
    }
    if (!bind) {
      throw new Error("Expected blob bind to start");
    }
    const [result, bindResult] = await Promise.all([reclaim, bind]);
    expect(result.reclaimedBlobIds).toContain(fixture.blobId);
    expect(bindResult).toMatchObject({
      error: { message: "Blob not found", status: 404 },
      kind: "rejected",
    });
    const blobRows = await db
      .select({ id: blobs.id })
      .from(blobs)
      .where(eq(blobs.id, fixture.blobId));
    const bindingRows = await db
      .select({ id: attachmentBindings.id })
      .from(attachmentBindings)
      .where(eq(attachmentBindings.id, fixture.rebind.binding.bindingId));
    expect(blobRows).toEqual([]);
    expect(bindingRows).toEqual([]);
  },
  30_000,
);
