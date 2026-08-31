import { expect, test } from "bun:test";
import { db, getDefaultApiDatabaseKind } from "@symcrypt/api-shared/postgres";
import {
  attachmentBindings,
  blobContentKeyEpochs,
  blobs,
  documents,
} from "@symcrypt/api-shared/schema";
import { createTestUser } from "@symcrypt/bob-and-alice";
import { and, eq, isNull } from "drizzle-orm";
import { authenticate } from "../../../../test/helpers/authenticate";
import {
  bindForTest,
  buildBind,
  stageBlob,
} from "../../../../test/helpers/blobAttachmentKit";
import { buildDocumentPurgeRequest } from "../../../../test/helpers/documentPurge";
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
import { runPurgeDocumentWorkflow } from "./purgeDocument";

async function createPurgeBindRaceFixture() {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const sourceDocument = await createDocument({ owner, root });
  const destinationDocument = await createDocument({ owner, root });
  const blobId = crypto.randomUUID();
  const initialBind = await buildBind({
    blobId,
    document: sourceDocument,
    owner,
    root,
    slotId: "purge-race-source",
    stagedBlob: await stageBlob(owner),
  });
  await bindForTest({
    blobId,
    owner,
    request: initialBind.request,
  });
  const racingBind = await buildBind({
    activeBindings: [initialBind.binding],
    blobId,
    document: destinationDocument,
    documents: [sourceDocument, destinationDocument],
    owner,
    root,
    slotId: "purge-race-destination",
  });
  return {
    blobId,
    destinationDocument,
    owner,
    purgeRequest: await buildDocumentPurgeRequest({
      documentId: sourceDocument.id,
      documentManifestHash: sourceDocument.accessManifest.manifestHash,
      owner,
      root,
    }),
    racingBind,
    sourceDocument,
  };
}

test.skipIf(getDefaultApiDatabaseKind() !== "postgres")(
  "a bind that reaches blob mutation first survives document purge",
  async () => {
    const fixture = await createPurgeBindRaceFixture();
    const epochLock = await holdPostgresLock(async (tx) => {
      const query = tx
        .select({ id: blobContentKeyEpochs.id })
        .from(blobContentKeyEpochs)
        .where(eq(blobContentKeyEpochs.blobId, fixture.blobId));
      await lockRowForUpdate(query);
    });

    const bind = bindForTest({
      blobId: fixture.blobId,
      owner: fixture.owner,
      request: fixture.racingBind.request,
    });
    let purge: ReturnType<typeof runPurgeDocumentWorkflow> | undefined;
    let synchronizationError: unknown;
    try {
      await waitForPostgresLockWait({
        blockerPid: epochLock.backendPid,
        queryFragment: "blob_content_key_epochs",
      });
      const activePurge = runPurgeDocumentWorkflow(db, {
        documentId: fixture.sourceDocument.id,
        fingerprint: fixture.owner.fingerprint,
        request: fixture.purgeRequest,
        userId: fixture.owner.userId,
      });
      purge = activePurge;
      await waitForPostgresLockWait({
        blockerPid: epochLock.backendPid,
        queryFragment: "access_manifest_heads",
      });
    } catch (error) {
      synchronizationError = error;
    } finally {
      await epochLock.release();
    }
    if (synchronizationError) {
      await Promise.allSettled([bind, ...(purge ? [purge] : [])]);
      throw synchronizationError;
    }
    if (!purge) {
      throw new Error("Expected document purge to start");
    }
    const [, purgeResult] = await Promise.all([bind, purge]);
    expect(purgeResult.response.documentId).toBe(fixture.sourceDocument.id);
    const destinationBindings = await db
      .select({ id: attachmentBindings.id })
      .from(attachmentBindings)
      .where(
        and(
          eq(attachmentBindings.documentId, fixture.destinationDocument.id),
          isNull(attachmentBindings.detachedAt),
        ),
      );
    expect(destinationBindings).toEqual([
      { id: fixture.racingBind.binding.bindingId },
    ]);
    const [blob] = await db
      .select({ dereferencedAt: blobs.dereferencedAt })
      .from(blobs)
      .where(eq(blobs.id, fixture.blobId));
    expect(blob?.dereferencedAt).toBeNull();
  },
  30_000,
);

test.skipIf(getDefaultApiDatabaseKind() !== "postgres")(
  "a purge that reaches blob mutation first rejects a stale bind",
  async () => {
    const fixture = await createPurgeBindRaceFixture();
    const documentLock = await holdPostgresLock(async (tx) => {
      const query = tx
        .select({ id: documents.id })
        .from(documents)
        .where(eq(documents.id, fixture.sourceDocument.id));
      await lockRowForUpdate(query);
    });

    const purge = runPurgeDocumentWorkflow(db, {
      documentId: fixture.sourceDocument.id,
      fingerprint: fixture.owner.fingerprint,
      request: fixture.purgeRequest,
      userId: fixture.owner.userId,
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
        blockerPid: documentLock.backendPid,
        queryFragment: "documents",
      });
      bind = bindForTest({
        blobId: fixture.blobId,
        owner: fixture.owner,
        request: fixture.racingBind.request,
      }).then(
        () => ({ kind: "fulfilled" as const }),
        (error: unknown) => ({ error, kind: "rejected" as const }),
      );
      await waitForPostgresLockWait({
        blockerPid: documentLock.backendPid,
        queryFragment: "access_manifest_heads",
      });
    } catch (error) {
      synchronizationError = error;
    } finally {
      await documentLock.release();
    }
    if (synchronizationError) {
      await Promise.allSettled([purge, ...(bind ? [bind] : [])]);
      throw synchronizationError;
    }
    if (!bind) {
      throw new Error("Expected blob bind to start");
    }
    const [purgeResult, bindResult] = await Promise.all([purge, bind]);
    expect(purgeResult.response.documentId).toBe(fixture.sourceDocument.id);
    expect(bindResult).toMatchObject({
      error: { status: 409 },
      kind: "rejected",
    });
    const destinationBindings = await db
      .select({ id: attachmentBindings.id })
      .from(attachmentBindings)
      .where(eq(attachmentBindings.documentId, fixture.destinationDocument.id));
    expect(destinationBindings).toEqual([]);
    const [blob] = await db
      .select({ dereferencedAt: blobs.dereferencedAt })
      .from(blobs)
      .where(eq(blobs.id, fixture.blobId));
    expect(blob?.dereferencedAt).toBeInstanceOf(Date);
  },
  30_000,
);
